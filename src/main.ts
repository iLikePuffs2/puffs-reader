import { Plugin, TFile, FuzzySuggestModal, WorkspaceLeaf, normalizePath } from 'obsidian';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { dirname, isAbsolute, join, resolve } from 'path';

const execAsync = promisify(exec);
import { ReaderView, READER_VIEW_TYPE } from './ReaderView';
import { SettingsTab } from './SettingsTab';
import { ReaderSettings, BookProgress, BookSettings, DEFAULT_SETTINGS } from './types';

/** 插件持久化数据结构 */
interface PluginData {
  settings: ReaderSettings;
  progress: Record<string, BookProgress>;
  bookSettings?: Record<string, BookSettings>;
  lastDataBackupAt?: number;
  knownBooks?: string[];
}

/**
 * TXT 文件选择弹窗
 * 使用 Obsidian 原生的模糊搜索 Modal，列出仓库中所有 .txt 文件供用户选择。
 */
class TxtFileSuggestModal extends FuzzySuggestModal<TFile> {
  private plugin: PuffsReaderPlugin;

  constructor(plugin: PuffsReaderPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder('选择要阅读的 TXT 文件...');
  }

  /** 获取仓库中全部 .txt 文件 */
  getItems(): TFile[] {
    return this.plugin.getSelectableBookFiles();
  }

  /** 显示文件路径作为选项文本 */
  getItemText(item: TFile): string {
    return item.path;
  }

  /** 用户选中后，在阅读器中打开该文件 */
  onChooseItem(item: TFile): void {
    this.plugin.openInReader(item);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  插件主类
// ═══════════════════════════════════════════════════════════════════════

export default class PuffsReaderPlugin extends Plugin {
  settings: ReaderSettings = DEFAULT_SETTINGS;
  progress: Record<string, BookProgress> = {};
  bookSettings: Record<string, BookSettings> = {};
  lastDataBackupAt = 0;
  knownBooks: string[] = [];
  private dataBackupTimer: number | null = null;
  private bookScanTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();

    // ── 注册阅读器视图类型（不绑定文件扩展名，改用命令触发） ──
    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));

    // ── 注册命令：唤出阅读器 ──
    this.addCommand({
      id: 'open-txt-in-reader',
      name: '在阅读器中打开 TXT 文件',
      callback: () => {
        // 如果当前激活的文件恰好是 .txt，直接打开；否则弹出文件选择器
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'txt') {
          this.openInReader(activeFile);
        } else {
          new TxtFileSuggestModal(this).open();
        }
      },
    });

    // ── 注册命令：在当前阅读器中打开全文搜索 ──
    this.addCommand({
      id: 'search-current-reader-book',
      name: 'Puffs Reader：全文搜索',
      hotkeys: [{ modifiers: ['Ctrl'], key: 'f' }],
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(ReaderView);
        if (view) view.toggleSearchFromHotkey();
      },
    });

    // ── 文件右键菜单：对 .txt 文件显示「在阅读器中打开」 ──
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'txt') {
          menu.addItem((item) => {
            item
              .setTitle('在 Puffs Reader 中打开')
              .setIcon('book-open')
              .onClick(() => this.openInReader(file));
          });
        }
      }),
    );

    // ── 设置面板 ──
    this.addSettingTab(new SettingsTab(this.app, this));
    this.scheduleNextDataBackup();
    this.scheduleBookLibraryScan();
  }

  onunload(): void {
    this.clearDataBackupTimer();
    if (this.bookScanTimer !== null) {
      window.clearTimeout(this.bookScanTimer);
      this.bookScanTimer = null;
    }
  }

  // ═══════════════════════════ 打开阅读器 ═══════════════════════════

  /**
   * 在新标签页中打开指定 TXT 文件的阅读器视图。
   * 通过 setViewState 将文件路径传递给 ReaderView。
   */
  async openInReader(file: TFile): Promise<void> {
    await this.markBookAsRecentlyRead(file.path);
    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: READER_VIEW_TYPE,
      state: { file: file.path },
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (view instanceof ReaderView) {
      view.focusReader();
    }
  }

  // ═══════════════════════════ 数据持久化 ═══════════════════════════

  async loadPluginData(): Promise<void> {
    const data = (await this.loadData()) as PluginData | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
    this.progress = data?.progress ?? {};
    this.bookSettings = data?.bookSettings ?? {};
    this.lastDataBackupAt = data?.lastDataBackupAt ?? 0;
    this.knownBooks = data?.knownBooks ?? [];

    // 旧版本把编码覆写存在 progress 中；这里保留读取兼容，同时迁移到单书设置。
    for (const [filePath, progress] of Object.entries(this.progress)) {
      if (progress.encoding && !this.bookSettings[filePath]?.encoding) {
        this.bookSettings[filePath] = {
          ...this.bookSettings[filePath],
          encoding: progress.encoding,
        };
      }
    }
  }

  async savePluginData(): Promise<void> {
    await this.writePluginData();
    await this.backupDataJsonIfDue();
  }

  async rescheduleDataBackup(): Promise<void> {
    this.scheduleNextDataBackup();
    await this.backupDataJsonIfDue();
  }

  private async writePluginData(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      progress: this.progress,
      bookSettings: this.bookSettings,
      lastDataBackupAt: this.lastDataBackupAt,
      knownBooks: this.knownBooks,
    } as PluginData);
  }

  private scheduleNextDataBackup(): void {
    this.clearDataBackupTimer();
    const frequencyMs = this.getDataBackupFrequencyMs();
    if (frequencyMs <= 0) return;
    const now = Date.now();
    const elapsed = this.lastDataBackupAt > 0 ? now - this.lastDataBackupAt : frequencyMs;
    const delay = Math.max(0, frequencyMs - elapsed);
    this.dataBackupTimer = window.setTimeout(() => {
      this.dataBackupTimer = null;
      this.backupDataJsonIfDue().catch((error) => console.error('Puffs Reader data backup failed', error));
    }, delay);
  }

  private clearDataBackupTimer(): void {
    if (this.dataBackupTimer === null) return;
    window.clearTimeout(this.dataBackupTimer);
    this.dataBackupTimer = null;
  }

  private async backupDataJsonIfDue(): Promise<void> {
    const frequencyMs = this.getDataBackupFrequencyMs();
    if (frequencyMs <= 0) return;
    if (this.lastDataBackupAt > 0 && Date.now() - this.lastDataBackupAt < frequencyMs) {
      this.scheduleNextDataBackup();
      return;
    }

    await this.writePluginData();
    await this.backupDataJson();
    this.lastDataBackupAt = Date.now();
    await this.writePluginData();
    this.scheduleNextDataBackup();
  }

  private getDataBackupFrequencyMs(): number {
    const hours = Number(this.settings.dataBackupFrequencyHours);
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    return hours * 60 * 60 * 1000;
  }

  private async backupDataJson(): Promise<void> {
    const sourcePath = normalizePath(`${this.getPluginDir()}/data.json`);
    if (!(await this.app.vault.adapter.exists(sourcePath))) {
      await this.writePluginData();
    }
    const content = await this.app.vault.adapter.read(sourcePath);
    const targetPath = this.getDataBackupPath();
    if (isAbsolute(targetPath)) {
      await fs.mkdir(dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf8');
      return;
    }
    const normalizedTarget = normalizePath(targetPath);
    const targetDir = normalizedTarget.split('/').slice(0, -1).join('/');
    if (targetDir) await this.ensureVaultFolder(targetDir);
    await this.app.vault.adapter.write(normalizedTarget, content);
  }

  private async ensureVaultFolder(folderPath: string): Promise<void> {
    const parts = normalizePath(folderPath).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private getDataBackupPath(): string {
    const customPath = this.settings.dataBackupPath.trim();
    if (customPath) {
      if (this.isDataBackupDirectoryPath(customPath)) {
        return isAbsolute(customPath) ? join(customPath, 'data.json') : normalizePath(`${customPath}/data.json`);
      }
      return customPath;
    }
    return normalizePath(`${this.getPluginDir()}/data.backup.json`);
  }

  private isDataBackupDirectoryPath(path: string): boolean {
    if (/[\\/]$/.test(path)) return true;
    const leaf = path.split(/[\\/]/).pop() ?? '';
    return !leaf.toLowerCase().endsWith('.json');
  }

  // ═══════════════════════════ 书库 Git 同步 ═══════════════════════════

  scheduleBookLibraryScan(): void {
    if (this.bookScanTimer !== null) {
      window.clearTimeout(this.bookScanTimer);
      this.bookScanTimer = null;
    }
    if (!this.settings.bookLibraryPath.trim()) return;
    this.bookScanTimer = window.setTimeout(() => {
      this.bookScanTimer = null;
      this.scanBookLibrary().catch((e) =>
        console.error('[Puffs Reader] Book library scan failed:', e),
      );
    }, 10000);
  }

  private async scanBookLibrary(): Promise<void> {
    const libPath = this.resolveBookLibraryPath();
    if (!libPath) return;

    const entries = await fs.readdir(libPath);
    const currentBooks = entries.filter((f) => f.toLowerCase().endsWith('.txt')).sort();

    const knownSorted = [...this.knownBooks].sort();
    const changed =
      currentBooks.length !== knownSorted.length ||
      currentBooks.some((b, i) => b !== knownSorted[i]);

    if (!changed) return;

    this.knownBooks = currentBooks;
    await this.savePluginData();
    await this.gitSyncBookLibrary(libPath);
  }

  private async gitSyncBookLibrary(libPath: string): Promise<void> {
    try {
      await execAsync('git add .', { cwd: libPath });
    } catch (e: unknown) {
      console.error('[Puffs Reader] Book library git add error:', this.gitErrMsg(e));
      return;
    }

    try {
      await execAsync('git commit -m "update book library"', { cwd: libPath });
    } catch (e: unknown) {
      const err = e as { message?: string; stdout?: string; stderr?: string };
      const combined = `${err.stdout ?? ''} ${err.stderr ?? ''} ${err.message ?? ''}`;
      if (combined.includes('nothing to commit') || combined.includes('nothing added to commit')) {
        console.log('[Puffs Reader] Book library: nothing to commit.');
        return;
      }
      console.error('[Puffs Reader] Book library git commit error:', this.gitErrMsg(e));
      return;
    }

    try {
      await execAsync('git push', { cwd: libPath });
      console.log('[Puffs Reader] Book library git sync completed successfully.');
    } catch (e: unknown) {
      console.error('[Puffs Reader] Book library git push error:', this.gitErrMsg(e));
    }
  }

  private gitErrMsg(e: unknown): string {
    const err = e as { message?: string; stdout?: string; stderr?: string };
    return [err.stderr, err.stdout, err.message].filter(Boolean).join(' | ');
  }

  private resolveBookLibraryPath(): string | null {
    const raw = this.settings.bookLibraryPath.trim();
    if (!raw) return null;
    if (isAbsolute(raw)) return raw;
    const vaultBasePath = (this.app.vault.adapter as { basePath?: string }).basePath ?? '';
    return join(vaultBasePath, raw);
  }

  getSelectableBookFiles(): TFile[] {
    const txtFiles = this.app.vault.getFiles().filter((file) => file.extension.toLowerCase() === 'txt');
    const libraryPath = this.resolveBookLibraryPath();
    const selectableFiles = libraryPath
      ? txtFiles.filter((file) => {
          const vaultBasePath = (this.app.vault.adapter as { basePath?: string }).basePath ?? '';
          const normalizedLibraryPath = resolve(libraryPath).toLowerCase();
          const parentPath = dirname(resolve(vaultBasePath, file.path)).toLowerCase();
          return parentPath === normalizedLibraryPath;
        })
      : txtFiles;

    return selectableFiles.sort((a, b) => {
      const lastReadDiff = (this.progress[b.path]?.lastRead ?? 0) - (this.progress[a.path]?.lastRead ?? 0);
      return lastReadDiff || a.path.localeCompare(b.path, 'zh-CN', { numeric: true });
    });
  }

  private getPluginDir(): string {
    return this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
  }

  // ═══════════════════════════ 阅读进度 ═══════════════════════════

  getProgress(filePath: string): BookProgress | undefined {
    return this.progress[filePath];
  }

  private async markBookAsRecentlyRead(filePath: string): Promise<void> {
    const saved = this.progress[filePath];
    this.progress[filePath] = {
      paragraphIndex: saved?.paragraphIndex ?? 0,
      charOffset: saved?.charOffset ?? 0,
      lastRead: Date.now(),
    };
    await this.savePluginData();
  }

  async saveProgress(filePath: string, progress: BookProgress): Promise<void> {
    this.progress[filePath] = progress;
    await this.savePluginData();
  }

  getBookSettings(filePath: string): BookSettings {
    return this.bookSettings[filePath] ?? {};
  }

  async saveBookSettings(filePath: string, settings: BookSettings): Promise<void> {
    const compact: BookSettings = {};
    if (settings.encoding) compact.encoding = settings.encoding;
    if (settings.firstLineIndent !== undefined) compact.firstLineIndent = settings.firstLineIndent;
    if (settings.tocRegex !== undefined && settings.tocRegex !== '') compact.tocRegex = settings.tocRegex;
    if (settings.chapterTitleRegex !== undefined && settings.chapterTitleRegex !== '') {
      compact.chapterTitleRegex = settings.chapterTitleRegex;
    }
    if (settings.tocIndentEnabled) {
      compact.tocIndentEnabled = true;
      compact.tocIndentLevel1Regex = settings.tocIndentLevel1Regex?.trim() || '\u5377';
      compact.tocIndentLevel2Regex = settings.tocIndentLevel2Regex?.trim() || '\u7ae0';
    }
    if (settings.annotations && settings.annotations.length > 0) {
      compact.annotations = settings.annotations;
    }
    this.bookSettings[filePath] = compact;
    await this.savePluginData();
  }
}
