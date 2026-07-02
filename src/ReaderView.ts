import {
  AbstractInputSuggest,
  App,
  ItemView,
  Modal,
  Menu,
  Notice,
  normalizePath,
  TFile,
  ViewStateResult,
  WorkspaceLeaf,
  setIcon,
  Scope,
} from 'obsidian';
import PuffsReaderPlugin from './main';
import {
  Annotation,
  BookSettings,
  BookTags,
  Chapter,
  CountedRange,
  DEFAULT_SETTINGS,
  ReadChapterRange,
  SearchMatch,
  SUPPORTED_ENCODINGS,
} from './types';

export const READER_VIEW_TYPE = 'puffs-reader-view';

interface ReaderPosition {
  paraIndex: number;
  charOffset: number;
}

interface AnnotationSelection {
  paraIndex: number;
  startOffset: number;
  endParaIndex: number;
  endOffset: number;
  length: number;
  text: string;
}

interface ReadingStatsPageRange {
  start: ReaderPosition;
  end: ReaderPosition;
  startOffset: number;
  endOffset: number;
}

type ReaderSidebarMode = 'toc' | 'search' | 'notes' | 'tags';
type EditableTagArrayGroup = 'genre' | 'feature';

const DEFAULT_READING_STATS_PAGE_MIN_MS = 100;
const DEFAULT_READING_STATS_IDLE_LIMIT_MS = 2 * 60 * 1000;

/**
 * Puffs Reader 阅读器核心视图。
 *
 * 只渲染当前页内容，并用「段落索引 + 字符偏移」记录页首/页尾，保证翻页连续。
 * 单书设置只保存真正与当前书相关的覆写项；没有覆写时全部回退到全局设置。
 */
export class ReaderView extends ItemView {
  plugin: PuffsReaderPlugin;

  private filePath = '';
  private currentFile: TFile | null = null;
  private fileBuffer: ArrayBuffer | null = null;
  private currentEncoding = 'utf-8';

  private rootEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private tocSidebar!: HTMLElement;
  private tocTitleEl!: HTMLElement;
  private tocModeBtn!: HTMLElement;
  private tocListEl!: HTMLElement;
  private searchPaneEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchInfoEl!: HTMLElement;
  private searchResultsEl!: HTMLElement;
  private readingArea!: HTMLElement;
  private contentContainer!: HTMLElement;
  private tagsBtn!: HTMLElement;
  private settingsBtn!: HTMLElement;
  private typographyPanel!: HTMLElement;
  private encodingBtn!: HTMLElement;
  private chapterTitleEl!: HTMLElement;
  private progressTitleEl!: HTMLElement;
  private searchBackBtn!: HTMLElement;

  private paragraphs: string[] = [];
  private paragraphStartOffsets: number[] = [0];
  private chapters: Chapter[] = [];
  private collapsedTocGroups = new Set<number>();
  private searchQuery = '';
  private searchResults: SearchMatch[] = [];

  private currentPageStart: ReaderPosition = { paraIndex: 0, charOffset: 0 };
  private currentPageEnd: ReaderPosition = { paraIndex: 0, charOffset: 0 };
  private pageBackStack: ReaderPosition[] = [];
  private searchJumpBackPos: ReaderPosition | null = null;
  private searchJumpPageTurns = 0;

  private isTocOpen = false;
  private sidebarMode: ReaderSidebarMode = 'toc';
  private isTypographyOpen = false;
  private isRenderingPage = false;
  private notesPaneEl!: HTMLElement;
  private tagsPaneEl!: HTMLElement;
  private tocTabsEl!: HTMLElement;
  private tocTabBtn!: HTMLElement;
  private notesTabBtn!: HTMLElement;

  private progressSaveTimer = 0;
  private readingStatsTimer = 0;
  private readingStatsPageKey = '';
  private readingStatsLastTurnAt = 0;
  private searchTimer = 0;
  private cursorHideTimer = 0;
  private lastManualPageTurnAt = 0;
  private resizeObserver: ResizeObserver | null = null;
  private boundGlobalKeydown: ((e: KeyboardEvent) => void) | null = null;
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private chapterCopyModal: ChapterRangeCopyModal | null = null;

  private spaceHoldTimer = 0;
  private spaceHoldFired = false;
  private spacePressedSelection: AnnotationSelection | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PuffsReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.scope = new Scope(this.app.scope);
    this.scope.register(null, 'Escape', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      return false;
    });
  }

  getViewType(): string {
    return READER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.currentFile?.basename ?? 'Puffs Reader';
  }

  getIcon(): string {
    return 'book-open';
  }

  async onOpen(): Promise<void> {
    this.buildUI();
  }

  async onClose(): Promise<void> {
    this.chapterCopyModal?.close();
    this.chapterCopyModal = null;
    this.settleReadingStatsTime();
    this.clearReadingStatsPageTimer();
    this.saveProgressNow();
    window.clearTimeout(this.progressSaveTimer);
    window.clearTimeout(this.searchTimer);
    this.clearCursorHideTimer();
    this.resizeObserver?.disconnect();
    if (this.boundGlobalKeydown) {
      document.removeEventListener('keydown', this.boundGlobalKeydown, true);
      window.removeEventListener('keydown', this.boundGlobalKeydown, true);
      this.boundGlobalKeydown = null;
    }
    if (this.boundMouseMove) {
      document.removeEventListener('mousemove', this.boundMouseMove, true);
      this.boundMouseMove = null;
    }
  }

  getState(): Record<string, unknown> {
    return { file: this.filePath };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const viewState = state as Record<string, unknown> | null;
    const path = viewState?.file as string | undefined;
    if (path && path !== this.filePath) {
      this.settleReadingStatsTime();
      this.clearReadingStatsPageTimer();
      this.filePath = path;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        this.currentFile = file;
        await this.loadContent();
      }
    }
    await super.setState(state, result);
    this.focusReader();
  }

  /** 供插件命令调用，打开当前阅读器的全文搜索。 */
  openSearch(query?: string): void {
    this.openSidebar('search', query);
  }

  /** 搜索快捷键重复触发时，在打开/关闭搜索面板之间切换。 */
  toggleSearchFromHotkey(): void {
    if (!this.shouldHandleSearchHotkey()) return;
    const selectedText = this.getSelectedSearchText();
    if (selectedText) {
      this.openSearch(selectedText);
      return;
    }
    if (this.isTocOpen && this.sidebarMode === 'search') {
      this.closeSidebar();
      this.focusReader();
      return;
    }
    this.openSearch();
  }

  /** 全局设置面板保存后调用，让已打开阅读器立即使用新排版。 */
  refreshSettingsFromGlobal(): void {
    this.applyTypography();
    this.resetCursorIdleState();
    this.reprocessCurrentText(true);
  }

  /** 供外部打开/切换书籍后调用，把键盘焦点稳定交给阅读区。 */
  focusReader(): void {
    this.focusReadingAreaSoon();
  }

  private buildUI(): void {
    const ce = this.contentEl;
    ce.empty();
    ce.addClass('puffs-reader-root');

    this.rootEl = ce.createDiv({ cls: 'puffs-reader-wrapper' });
    this.bodyEl = this.rootEl.createDiv({ cls: 'puffs-body' });

    this.buildTocSidebar();
    this.buildReadingArea();
    this.buildTypographyPanel();
    this.bindWorkspaceFocusEvents();
    this.bindGlobalKeys();
    this.bindCursorAutoHide();
    this.applyTypography();
    this.resetCursorIdleState();
  }

  private bindWorkspaceFocusEvents(): void {
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf) {
          this.readingStatsLastTurnAt = Date.now();
          this.scheduleReadingPageStats();
          this.focusReader();
          this.resetCursorIdleState();
        } else {
          this.settleReadingStatsTime();
          this.clearReadingStatsPageTimer();
          this.showCursor();
          this.clearCursorHideTimer();
        }
      }),
    );
  }

  private buildTocSidebar(): void {
    this.tocSidebar = this.bodyEl.createDiv({ cls: 'puffs-toc-sidebar puffs-hidden' });

    const header = this.tocSidebar.createDiv({ cls: 'puffs-toc-header' });
    this.tocTitleEl = header.createSpan({ cls: 'puffs-toc-title', text: '目录' });
    this.tagsBtn = header.createEl('button', {
      cls: 'puffs-icon-btn puffs-toc-search-btn',
      attr: { 'aria-label': '书籍标签' },
    });
    setIcon(this.tagsBtn, 'tags');
    this.tagsBtn.addEventListener('click', () => this.openSidebar(this.sidebarMode === 'tags' ? 'toc' : 'tags'));

    this.settingsBtn = header.createEl('button', {
      cls: 'puffs-icon-btn puffs-toc-search-btn',
      attr: { 'aria-label': '书籍设置' },
    });
    setIcon(this.settingsBtn, 'settings');
    this.settingsBtn.addEventListener('click', () => this.toggleTypography());

    this.tocModeBtn = header.createEl('button', {
      cls: 'puffs-icon-btn puffs-toc-search-btn',
      attr: { 'aria-label': '全书搜索' },
    });
    setIcon(this.tocModeBtn, 'search');
    this.tocModeBtn.addEventListener('click', () => this.toggleSearchMode());

    this.tocTabsEl = this.tocSidebar.createDiv({ cls: 'puffs-toc-tabs' });
    this.tocTabBtn = this.tocTabsEl.createDiv({ cls: 'puffs-toc-tab', text: '目录' });
    this.notesTabBtn = this.tocTabsEl.createDiv({ cls: 'puffs-toc-tab', text: '笔记' });
    this.tocTabBtn.addEventListener('click', () => this.switchSidebarMode('toc'));
    this.notesTabBtn.addEventListener('click', () => this.switchSidebarMode('notes'));

    this.tocListEl = this.tocSidebar.createDiv({ cls: 'puffs-toc-list' });
    this.notesPaneEl = this.tocSidebar.createDiv({ cls: 'puffs-notes-pane puffs-hidden' });
    this.tagsPaneEl = this.tocSidebar.createDiv({ cls: 'puffs-tags-pane puffs-hidden' });

    this.searchPaneEl = this.tocSidebar.createDiv({ cls: 'puffs-sidebar-search puffs-hidden' });
    const searchHeader = this.searchPaneEl.createDiv({ cls: 'puffs-search-header' });
    this.searchInput = searchHeader.createEl('input', {
      cls: 'puffs-search-input',
      attr: { type: 'text', placeholder: '' },
    });
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.searchInput.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.performSearch(this.searchInput.value), 160);
    });

    this.searchInfoEl = this.searchPaneEl.createDiv({ cls: 'puffs-search-info' });
    this.searchResultsEl = this.searchPaneEl.createDiv({ cls: 'puffs-search-results' });
  }

  private buildReadingArea(): void {
    this.readingArea = this.bodyEl.createDiv({ cls: 'puffs-reading-area' });
    this.readingArea.tabIndex = 0;

    this.chapterTitleEl = this.readingArea.createDiv({ cls: 'puffs-page-chapter' });
    this.progressTitleEl = this.readingArea.createDiv({ cls: 'puffs-page-progress' });

    this.searchBackBtn = this.readingArea.createEl('button', {
      cls: 'puffs-search-back puffs-hidden',
      text: '返回',
      attr: { 'aria-label': '返回搜索前位置' },
    });
    this.searchBackBtn.addEventListener('click', () => this.returnFromSearchJump());

    this.contentContainer = this.readingArea.createDiv({ cls: 'puffs-page-content' });
    this.contentContainer.addEventListener('contextmenu', (e) => this.handleAnnotationContextMenu(e));

    this.readingArea.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.readingArea.addEventListener('keyup', (e) => this.handleKeyup(e));
    this.readingArea.addEventListener('pointerdown', (e) => this.closePanelsOnOutsideClick(e));
    this.readingArea.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 10) return;
      if (e.deltaY > 0) this.pageDown();
      else this.pageUp();
    }, { passive: false });

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.isRenderingPage && this.paragraphs.length > 0) {
        this.renderCurrentPage();
      }
    });
    this.resizeObserver.observe(this.readingArea);
  }

  private buildTypographyPanel(): void {
    this.typographyPanel = this.readingArea.createDiv({ cls: 'puffs-typo-panel puffs-hidden' });
    this.refreshTypographyPanel();
  }

  private async loadContent(): Promise<void> {
    if (!this.currentFile) return;

    this.fileBuffer = await this.app.vault.readBinary(this.currentFile);
    const saved = this.plugin.getProgress(this.currentFile.path);
    const bookSettings = this.getBookSettings();
    const { text, encoding } = this.decodeBuffer(this.fileBuffer, bookSettings.encoding ?? saved?.encoding);

    this.currentEncoding = encoding;
    this.paragraphs = this.processText(text);
    this.rebuildParagraphStartOffsets();
    this.parseChapters();
    this.buildTocList();
    this.updateSidebarTitle();
    this.applyTypography();

    this.currentPageStart = this.clampPosition({
      paraIndex: saved?.paragraphIndex ?? 0,
      charOffset: saved?.charOffset ?? 0,
    });
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.focusReadingAreaSoon();
  }

  private focusReadingAreaSoon(): void {
    if (!this.readingArea || !this.readingArea.isConnected) return;
    this.readingArea.focus();
    requestAnimationFrame(() => {
      if (!this.readingArea.isConnected) return;
      this.readingArea.focus();
      window.setTimeout(() => {
        if (this.readingArea.isConnected) this.readingArea.focus();
      }, 0);
    });
  }

  private decodeBuffer(buffer: ArrayBuffer, forceEncoding?: string): { text: string; encoding: string } {
    if (forceEncoding) {
      try {
        return {
          text: new TextDecoder(forceEncoding, { fatal: false }).decode(buffer),
          encoding: forceEncoding,
        };
      } catch {
        // 指定编码不可用时继续走自动检测。
      }
    }

    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(buffer), encoding: 'utf-16le' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(buffer), encoding: 'utf-16be' };
    }

    try {
      return {
        text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
        encoding: 'utf-8',
      };
    } catch {
      // 非 UTF-8 时优先尝试中文 TXT 常见编码。
    }

    try {
      return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' };
    } catch {
      const fallback = this.plugin.settings.defaultEncoding;
      return { text: new TextDecoder(fallback, { fatal: false }).decode(buffer), encoding: fallback };
    }
  }

  private switchEncoding(encoding: string): void {
    if (!this.fileBuffer || !this.currentFile) return;

    this.settleReadingStatsTime();
    this.clearReadingStatsPageTimer();
    const { text } = this.decodeBuffer(this.fileBuffer, encoding);
    this.currentEncoding = encoding;
    this.paragraphs = this.processText(text);
    this.rebuildParagraphStartOffsets();
    this.updateBookSettings({ encoding });
    this.parseChapters();
    this.buildTocList();
    this.currentPageStart = { paraIndex: 0, charOffset: 0 };
    this.pageBackStack = [];
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: 0,
      charOffset: 0,
      lastRead: Date.now(),
    });
    this.refreshTypographyPanel();
    this.renderCurrentPage();
  }

  private showEncodingMenu(e: MouseEvent): void {
    const menu = new Menu();
    for (const enc of SUPPORTED_ENCODINGS) {
      menu.addItem((item) =>
        item
          .setTitle(enc.label)
          .setChecked(this.currentEncoding === enc.value)
          .onClick(() => this.switchEncoding(enc.value)),
      );
    }
    menu.showAtMouseEvent(e);
  }

  private processText(text: string): string[] {
    let lines = text.split(/\r?\n/);
    if (this.getEffectiveRemoveExtraBlankLines()) {
      lines = lines.filter((line) => line.trim() !== '');
    }
    lines = this.removeBlankLinesAfterChapter(lines);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines;
  }

  private reprocessCurrentText(preservePosition: boolean): void {
    if (!this.fileBuffer) {
      this.renderCurrentPage();
      return;
    }

    const currentOffset = preservePosition ? this.positionToGlobalOffset(this.currentPageStart) : 0;
    const { text } = this.decodeBuffer(this.fileBuffer, this.currentEncoding);
    this.paragraphs = this.processText(text);
    this.rebuildParagraphStartOffsets();
    this.parseChapters();
    this.buildTocList();
    this.currentPageStart = preservePosition
      ? this.globalOffsetToPosition(currentOffset)
      : { paraIndex: 0, charOffset: 0 };
    this.currentPageEnd = this.currentPageStart;
    this.pageBackStack = [];

    if (this.searchQuery) {
      this.performSearch(this.searchQuery);
      return;
    }
    this.renderCurrentPage();
  }

  private rebuildParagraphStartOffsets(): void {
    this.paragraphStartOffsets = [0];
    let offset = 0;
    for (let i = 0; i < this.paragraphs.length; i++) {
      offset += this.paragraphs[i].length;
      if (i < this.paragraphs.length - 1) offset += 1;
      this.paragraphStartOffsets.push(offset);
    }
  }

  /** 章节标题后面的空行只会拉开章节名和正文第一段，这里直接清理掉。 */
  private removeBlankLinesAfterChapter(lines: string[]): string[] {
    let regexes: RegExp[];
    try {
      regexes = this.getChapterMatchRegexes();
    } catch {
      return lines;
    }
    if (regexes.length === 0) return lines;

    const cleaned: string[] = [];
    let previousWasChapter = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (previousWasChapter && trimmed === '') continue;

      cleaned.push(line);
      previousWasChapter = trimmed !== '' && regexes.some((regex) => regex.test(trimmed));
    }
    return cleaned;
  }

  private renderCurrentPage(): void {
    if (this.paragraphs.length === 0) {
      this.clearReadingStatsPageTimer();
      this.contentContainer.empty();
      this.chapterTitleEl.textContent = '';
      this.progressTitleEl.textContent = '';
      return;
    }

    // Obsidian 刚创建 leaf 时可能还没完成布局；此时 clientHeight 为 0。
    if (this.contentContainer.clientHeight < 40) {
      requestAnimationFrame(() => {
        if (this.contentContainer.clientHeight >= 40) this.renderCurrentPage();
      });
      return;
    }

    this.isRenderingPage = true;
    this.currentPageStart = this.skipBlankPageStart(this.clampPosition(this.currentPageStart));
    this.currentPageEnd = this.measurePageEnd(this.currentPageStart);
    this.paintPage(this.currentPageStart, this.currentPageEnd);
    this.trimPaintedPageToFit();
    this.fillPaintedPageToFit();
    this.updatePageMeta();
    this.scheduleProgressSave();
    this.scheduleReadingPageStats();
    this.isRenderingPage = false;
  }

  /** 在真实容器内临时排版，找出当前页可以容纳到哪个字符位置。 */
  private measurePageEnd(start: ReaderPosition): ReaderPosition {
    this.contentContainer.empty();
    const normalizedStart = this.skipBlankPageStart(this.clampPosition(start));
    let offset = normalizedStart.charOffset;
    let lastFit = normalizedStart;
    const chapterEndPara = this.getChapterEndPara(normalizedStart.paraIndex);

    for (let pi = normalizedStart.paraIndex; pi < this.paragraphs.length; pi++) {
      if (chapterEndPara !== null && pi >= chapterEndPara) {
        return this.clampPosition({ paraIndex: chapterEndPara, charOffset: 0 });
      }

      const text = this.paragraphs[pi];
      const slice = text.slice(offset);
      const para = this.createParagraphEl(slice, pi, offset, false);
      this.contentContainer.appendChild(para);

      if (this.isContentOverflowing()) {
        const cut = this.findLastCompleteLineOffset(para, slice);
        if (cut > 0) {
          return this.clampPosition({ paraIndex: pi, charOffset: offset + cut });
        }
        return lastFit;
      }

      lastFit = this.clampPosition({ paraIndex: pi, charOffset: text.length });
      offset = 0;
    }

    return { paraIndex: this.paragraphs.length, charOffset: 0 };
  }

  private paintPage(start: ReaderPosition, end: ReaderPosition): void {
    this.contentContainer.empty();
    const from = this.clampPosition(start);
    const to = this.clampPosition(end);

    for (let pi = from.paraIndex; pi < Math.min(to.paraIndex + 1, this.paragraphs.length); pi++) {
      const fullText = this.paragraphs[pi];
      const begin = pi === from.paraIndex ? from.charOffset : 0;
      const finish = pi === to.paraIndex ? to.charOffset : fullText.length;
      if (pi === to.paraIndex && finish <= begin) continue;
      if (pi > to.paraIndex) continue;

      const visible = fullText.slice(begin, finish);
      const continuesAfterPage = finish < fullText.length;
      this.contentContainer.appendChild(this.createParagraphEl(visible, pi, begin, true, continuesAfterPage));
    }
  }

  private createParagraphEl(
    text: string,
    paraIndex: number,
    charOffset: number,
    withHighlight: boolean,
    continuesAfterPage = false,
  ): HTMLElement {
    const p = document.createElement('p');
    p.className = 'puffs-para';
    p.dataset.paraIndex = String(paraIndex);
    p.dataset.charOffset = String(charOffset);
    p.dataset.leadingIndentLength = String(this.getLeadingIndentLength(text, charOffset));
    if (charOffset > 0) {
      p.classList.add('puffs-para-fragment');
    }

    const chapter = charOffset === 0 ? this.getChapterStartingAt(paraIndex) : null;
    if (chapter) {
      p.classList.add('puffs-para-chapter');
      p.textContent = chapter.title;
      return p;
    }

    if (text.trim() === '') {
      p.classList.add('puffs-para-blank');
      p.innerHTML = '&nbsp;';
      return p;
    }

    // 分页截断出的临时段落并不是真正的段尾；让它的末行也参与两端对齐。
    if (continuesAfterPage) {
      p.classList.add('puffs-para-continued');
    }

    if (withHighlight) {
      const html = this.buildDecoratedHTML(text, paraIndex, charOffset);
      if (html !== null) {
        p.innerHTML = html;
        return p;
      }
    }

    p.textContent = this.getRenderableParagraphText(text, charOffset);
    return p;
  }

  /**
   * 把当前段落的可见区间内涉及到的搜索高亮 + 标注/批注合并渲染为 HTML。
   * 没有任何装饰时返回 null，让调用方走 textContent 快路径。
   */
  private buildDecoratedHTML(text: string, paraIndex: number, charOffset: number): string | null {
    const end = charOffset + text.length;
    const annos = this.getAnnotations()
      .map((a, idx) => ({ a, idx, segment: this.getAnnotationSegment(a, paraIndex) }))
      .filter(({ segment }) => segment !== null && segment.startOffset < end && segment.endOffset > charOffset);
    const searches = this.searchResults
      .filter((m) => m.paraIndex === paraIndex && m.startOffset < end && m.startOffset + m.length > charOffset);

    if (annos.length === 0 && searches.length === 0) return null;

    type Token = {
      start: number;
      end: number;
      kind: 'anno' | 'search';
      annoIdx?: number;
      hasNote?: boolean;
    };
    const tokens: Token[] = [];
    const leadingPlainEnd = this.getLeadingIndentLength(text, charOffset);
    for (const { a, idx, segment } of annos) {
      if (!segment) continue;
      const localStart = Math.max(leadingPlainEnd, segment.startOffset - charOffset);
      const localEnd = Math.min(text.length, segment.endOffset - charOffset);
      if (localEnd <= localStart) continue;
      tokens.push({
        start: localStart,
        end: localEnd,
        kind: 'anno',
        annoIdx: idx,
        hasNote: !!a.note,
      });
    }
    for (const m of searches) {
      const localStart = Math.max(leadingPlainEnd, m.startOffset - charOffset);
      const localEnd = Math.min(text.length, m.startOffset + m.length - charOffset);
      if (localEnd <= localStart) continue;
      tokens.push({ start: localStart, end: localEnd, kind: 'search' });
    }
    tokens.sort((a, b) => a.start - b.start || (a.kind === 'anno' ? -1 : 1));

    let result = '';
    let cursor = leadingPlainEnd;
    for (const t of tokens) {
      if (t.start < cursor) continue;
      if (t.start > cursor) result += this.escapeHTML(text.slice(cursor, t.start));
      const inner = text.slice(t.start, t.end);
      if (t.kind === 'search') {
        result += `<span class="puffs-search-hl">${this.escapeHTML(inner)}</span>`;
      } else {
        const cls = t.hasNote ? 'puffs-annotation puffs-has-note' : 'puffs-annotation';
        const idxAttr = t.annoIdx !== undefined ? ` data-anno-idx="${t.annoIdx}"` : '';
        result += `<span class="${cls}"${idxAttr}>${this.escapeHTML(inner)}</span>`;
      }
      cursor = t.end;
    }
    if (cursor < text.length) result += this.escapeHTML(text.slice(cursor));
    return result;
  }

  private getLeadingIndentLength(text: string, charOffset: number): number {
    if (charOffset !== 0) return 0;
    return text.match(/^[\s\u3000]+/)?.[0].length ?? 0;
  }

  private getRenderableParagraphText(text: string, charOffset: number): string {
    const leadingLength = this.getLeadingIndentLength(text, charOffset);
    return leadingLength > 0 ? text.slice(leadingLength) : text;
  }

  private isContentOverflowing(): boolean {
    return this.contentContainer.scrollHeight > this.contentContainer.clientHeight;
  }

  /** 最终以真实绘制结果兜底，尽量只截短最后一段，减少页底空白。 */
  private trimPaintedPageToFit(): void {
    let guard = 0;
    while (this.isContentOverflowing() && guard < 20) {
      const last = this.contentContainer.lastElementChild as HTMLElement | null;
      if (!last) return;

      const paraIndex = Number(last.dataset.paraIndex);
      const charOffset = Number(last.dataset.charOffset);
      if (!Number.isFinite(paraIndex) || !Number.isFinite(charOffset)) return;

      const paragraphEnd = paraIndex === this.currentPageEnd.paraIndex
        ? this.currentPageEnd.charOffset
        : this.paragraphs[paraIndex]?.length ?? charOffset;
      const visibleLength = Math.max(0, paragraphEnd - charOffset);
      if (visibleLength <= 1) {
        const nextEnd = this.clampPosition({ paraIndex, charOffset });
        if (this.comparePositions(nextEnd, this.currentPageStart) <= 0) return;
        this.currentPageEnd = nextEnd;
        this.paintPage(this.currentPageStart, this.currentPageEnd);
        guard++;
        continue;
      }

      let low = 1;
      let high = visibleLength;
      let best = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = this.clampPosition({ paraIndex, charOffset: charOffset + mid });
        this.paintPage(this.currentPageStart, candidate);
        if (this.isContentOverflowing()) {
          high = mid - 1;
        } else {
          best = mid;
          low = mid + 1;
        }
      }

      if (best <= 0) {
        const nextEnd = this.clampPosition({ paraIndex, charOffset });
        if (this.comparePositions(nextEnd, this.currentPageStart) <= 0) return;
        this.currentPageEnd = nextEnd;
        this.paintPage(this.currentPageStart, this.currentPageEnd);
        guard++;
        continue;
      }
      this.currentPageEnd = this.clampPosition({ paraIndex, charOffset: charOffset + best });
      this.paintPage(this.currentPageStart, this.currentPageEnd);
      guard++;
    }
  }

  /**
   * trimPaintedPageToFit() only removes overflowing text. If measuring stopped at
   * the previous paragraph boundary, try to pull the next paragraph's first
   * complete lines into the current page without crossing the chapter boundary.
   */
  private fillPaintedPageToFit(): void {
    if (this.isContentOverflowing()) return;

    const fillLimit = this.getCurrentPageFillLimit();
    if (this.comparePositions(this.currentPageEnd, fillLimit) >= 0) return;

    let best = this.currentPageEnd;
    let probe = this.clampPosition(best);

    for (let pi = probe.paraIndex; pi < Math.min(fillLimit.paraIndex + 1, this.paragraphs.length); pi++) {
      if (pi > fillLimit.paraIndex) break;

      const paragraph = this.paragraphs[pi];
      const begin = pi === probe.paraIndex ? probe.charOffset : 0;
      const high = pi === fillLimit.paraIndex ? fillLimit.charOffset : paragraph.length;
      if (high <= begin) continue;

      const fullCandidate = this.clampPosition({ paraIndex: pi, charOffset: high });
      this.paintPage(this.currentPageStart, fullCandidate);
      if (!this.isContentOverflowing()) {
        best = fullCandidate;
        continue;
      }

      let low = begin + 1;
      let upper = high;
      let localBest: ReaderPosition | null = null;
      while (low <= upper) {
        const mid = Math.floor((low + upper) / 2);
        const candidate = this.clampPosition({ paraIndex: pi, charOffset: mid });
        this.paintPage(this.currentPageStart, candidate);
        if (this.isContentOverflowing()) {
          upper = mid - 1;
        } else {
          localBest = candidate;
          low = mid + 1;
        }
      }

      if (localBest !== null) best = localBest;
      break;
    }

    this.currentPageEnd = best;
    this.paintPage(this.currentPageStart, this.currentPageEnd);
  }

  private getCurrentPageFillLimit(): ReaderPosition {
    const chapterEndPara = this.getChapterEndPara(this.currentPageStart.paraIndex);
    if (chapterEndPara !== null) {
      return this.clampPosition({ paraIndex: chapterEndPara, charOffset: 0 });
    }
    return { paraIndex: this.paragraphs.length, charOffset: 0 };
  }

  /**
   * 返回当前溢出段落中最后一条「完整可见行」结束的字符偏移。
   * 通过 Range 读取浏览器实际换行后的矩形，避免使用估算行高造成翻页漂移。
   */
  private findLastCompleteLineOffset(para: HTMLElement, text: string): number {
    if (text.length === 0) return 0;

    const style = getComputedStyle(this.contentContainer);
    const bottomPadding = parseFloat(style.paddingBottom || '0') || 0;
    const bottomGuard = 1;
    const bottomLimit = this.contentContainer.getBoundingClientRect().bottom - bottomPadding - bottomGuard;
    const range = document.createRange();
    let lastLineTop = Number.NaN;
    let lastLineBottom = 0;
    let lastCompleteOffset = 0;

    const paraCharOffset = Number(para.dataset.charOffset);
    let globalOffset = this.getLeadingIndentLength(text, Number.isFinite(paraCharOffset) ? paraCharOffset : 0);
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;

    outer:
    while (node) {
      const length = node.textContent?.length ?? 0;
      for (let i = 0; i < length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        const nextOffset = globalOffset + i + 1;
        if (rect.width === 0 && rect.height === 0) continue;

        const top = Math.round(rect.top);
        if (!Number.isNaN(lastLineTop) && Math.abs(top - lastLineTop) > 1) {
          if (lastLineBottom <= bottomLimit) lastCompleteOffset = globalOffset + i;
        }

        if (rect.top > bottomLimit) break outer;
        lastLineTop = top;
        lastLineBottom = rect.bottom;
        lastCompleteOffset = nextOffset;
      }
      globalOffset += length;
      node = walker.nextNode() as Text | null;
    }

    if (lastLineBottom <= bottomLimit) lastCompleteOffset = Math.min(globalOffset, text.length);
    range.detach();
    return lastCompleteOffset;
  }

  private pageDown(): boolean {
    if (this.comparePositions(this.currentPageEnd, this.currentPageStart) <= 0) return false;
    if (this.currentPageEnd.paraIndex >= this.paragraphs.length) return false;
    this.settleReadingStatsTime(Date.now(), true);
    this.clearReadingStatsPageTimer();
    this.pageBackStack.push({ ...this.currentPageStart });
    this.currentPageStart = this.skipBlankPageStart(this.clampPosition(this.currentPageEnd));
    this.recordPageTurnAfterSearchJump();
    this.renderCurrentPage();
    this.readingArea.focus();
    return true;
  }

  private pageUp(): boolean {
    if (this.currentPageStart.paraIndex === 0 && this.currentPageStart.charOffset === 0) return false;
    this.settleReadingStatsTime(Date.now(), true);
    this.clearReadingStatsPageTimer();
    this.currentPageStart = this.pageBackStack.pop() ?? this.findPreviousPageStart(this.currentPageStart);
    this.recordPageTurnAfterSearchJump();
    this.renderCurrentPage();
    this.readingArea.focus();
    return true;
  }

  private tryManualPageTurn(direction: 'next' | 'previous'): void {
    if (!this.canManualPageTurnNow()) return;
    const didTurn = direction === 'next' ? this.pageDown() : this.pageUp();
    if (didTurn) this.lastManualPageTurnAt = performance.now();
  }

  private canManualPageTurnNow(): boolean {
    const limit = this.plugin.settings.manualPageTurnsPerSecond;
    if (!Number.isFinite(limit) || limit <= 0) return true;
    if (this.lastManualPageTurnAt === 0) return true;
    const now = performance.now();
    const minIntervalMs = 1000 / limit;
    return now - this.lastManualPageTurnAt >= minIntervalMs;
  }

  /** 反向翻页用前向测量逼近，保证上一页结束位置正好衔接当前页首。 */
  private findPreviousPageStart(target: ReaderPosition): ReaderPosition {
    let windowStart = Math.max(0, target.paraIndex - 160);
    let bestStart: ReaderPosition = { paraIndex: 0, charOffset: 0 };

    while (true) {
      let pos: ReaderPosition = { paraIndex: windowStart, charOffset: 0 };
      let previous = pos;
      let guard = 0;
      while (this.comparePositions(pos, target) < 0 && guard < 2000) {
        previous = pos;
        const end = this.measurePageEnd(pos);
        if (this.comparePositions(end, target) >= 0) return previous;
        pos = end;
        guard++;
      }
      bestStart = previous;
      if (windowStart === 0) return bestStart;
      windowStart = Math.max(0, windowStart - 320);
    }
  }

  private jumpToPosition(pos: ReaderPosition): void {
    this.settleReadingStatsTime(Date.now(), true);
    this.clearReadingStatsPageTimer();
    this.currentPageStart = this.clampPosition(pos);
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }

  private clampPosition(pos: ReaderPosition): ReaderPosition {
    if (this.paragraphs.length === 0) return { paraIndex: 0, charOffset: 0 };
    let paraIndex = Math.max(0, Math.min(pos.paraIndex, this.paragraphs.length));
    let charOffset = Math.max(0, pos.charOffset);
    while (paraIndex < this.paragraphs.length && charOffset >= this.paragraphs[paraIndex].length) {
      if (this.paragraphs[paraIndex].length === 0 && charOffset === 0) break;
      charOffset = 0;
      paraIndex++;
    }
    if (paraIndex >= this.paragraphs.length) return { paraIndex: this.paragraphs.length, charOffset: 0 };
    const paragraph = this.paragraphs[paraIndex];
    const clampedOffset = Math.min(charOffset, paragraph.length);
    return {
      paraIndex,
      charOffset: this.normalizePageCharOffset(paragraph, clampedOffset),
    };
  }

  private normalizePageCharOffset(paragraph: string, charOffset: number): number {
    const leadingLength = this.getLeadingIndentLength(paragraph, 0);
    return charOffset <= leadingLength ? 0 : charOffset;
  }

  private skipBlankPageStart(pos: ReaderPosition): ReaderPosition {
    let next = this.clampPosition(pos);
    while (
      next.paraIndex < this.paragraphs.length &&
      next.charOffset === 0 &&
      this.paragraphs[next.paraIndex].trim() === ''
    ) {
      next = this.clampPosition({ paraIndex: next.paraIndex + 1, charOffset: 0 });
    }
    return next;
  }

  private comparePositions(a: ReaderPosition, b: ReaderPosition): number {
    if (a.paraIndex !== b.paraIndex) return a.paraIndex - b.paraIndex;
    return a.charOffset - b.charOffset;
  }

  private positionToGlobalOffset(pos: ReaderPosition): number {
    if (this.paragraphs.length === 0) return 0;
    const clamped = this.clampPosition(pos);
    if (clamped.paraIndex >= this.paragraphs.length) {
      return this.paragraphStartOffsets[this.paragraphs.length] ?? 0;
    }
    return (this.paragraphStartOffsets[clamped.paraIndex] ?? 0) + clamped.charOffset;
  }

  private globalOffsetToPosition(offset: number): ReaderPosition {
    if (this.paragraphs.length === 0) return { paraIndex: 0, charOffset: 0 };
    const total = this.paragraphStartOffsets[this.paragraphs.length] ?? 0;
    const target = Math.max(0, Math.min(offset, total));
    if (target >= total) return { paraIndex: this.paragraphs.length, charOffset: 0 };

    let low = 0;
    let high = this.paragraphs.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = this.paragraphStartOffsets[mid] ?? 0;
      const next = this.paragraphStartOffsets[mid + 1] ?? start;
      if (target < start) {
        high = mid - 1;
      } else if (target >= next) {
        low = mid + 1;
      } else {
        return {
          paraIndex: mid,
          charOffset: Math.min(target - start, this.paragraphs[mid].length),
        };
      }
    }
    return { paraIndex: this.paragraphs.length, charOffset: 0 };
  }

  private getCurrentPageStatsRange(): ReadingStatsPageRange | null {
    if (this.paragraphs.length === 0) return null;
    const start = this.clampPosition(this.currentPageStart);
    const end = this.clampPosition(this.currentPageEnd);
    const startOffset = this.positionToGlobalOffset(start);
    const endOffset = this.positionToGlobalOffset(end);
    if (endOffset <= startOffset) return null;
    return { start, end, startOffset, endOffset };
  }

  private scheduleReadingPageStats(): void {
    this.clearReadingStatsPageTimer();
    if (!this.currentFile || this.paragraphs.length === 0) return;
    if (!this.isReadingStatsActive()) return;

    const range = this.getCurrentPageStatsRange();
    if (!range) return;
    if (this.readingStatsLastTurnAt === 0) this.readingStatsLastTurnAt = Date.now();

    const pageKey = this.getReadingStatsPageKey(range);
    this.readingStatsPageKey = pageKey;
    this.readingStatsTimer = window.setTimeout(() => {
      this.commitReadingPageStats(pageKey);
    }, this.getReadingStatsMinPageMs());
  }

  private clearReadingStatsPageTimer(): void {
    if (this.readingStatsTimer) {
      window.clearTimeout(this.readingStatsTimer);
      this.readingStatsTimer = 0;
    }
    this.readingStatsPageKey = '';
  }

  private getReadingStatsPageKey(range: ReadingStatsPageRange): string {
    return `${this.currentFile?.path ?? ''}:${range.startOffset}:${range.endOffset}`;
  }

  private commitReadingPageStats(pageKey: string): void {
    if (!this.currentFile || !this.isReadingStatsActive()) return;
    const range = this.getCurrentPageStatsRange();
    if (!range || pageKey !== this.getReadingStatsPageKey(range)) return;

    const countedRange = { start: range.startOffset, end: range.endOffset };
    const existingRanges = this.plugin.getReadingStats().books[this.currentFile.path]?.countedRanges ?? [];
    const uncountedRanges = this.getUncountedRanges(countedRange, existingRanges);
    if (uncountedRanges.length === 0) return;

    const readWords = this.countWordsInGlobalRanges(uncountedRanges);
    const chapterRanges = this.getReadChapterRangesForPage(range.start, range.end);
    this.plugin.recordReadingStat({
      filePath: this.currentFile.path,
      title: this.currentFile.basename,
      readWords,
      countedRange,
      chapterRanges,
      timestamp: Date.now(),
    }).catch((error) => console.error('[Puffs Reader] Failed to record reading page stats:', error));
  }

  private settleReadingStatsTime(now = Date.now(), keepSession = false): void {
    if (!this.currentFile || this.readingStatsLastTurnAt <= 0) {
      if (!keepSession) this.readingStatsLastTurnAt = 0;
      return;
    }
    const elapsed = Math.max(0, now - this.readingStatsLastTurnAt);
    const readingMs = Math.min(elapsed, this.getReadingStatsIdleLimitMs());
    if (readingMs > 0) {
      this.plugin.recordReadingStat({
        filePath: this.currentFile.path,
        title: this.currentFile.basename,
        readingMs,
        timestamp: now,
      }).catch((error) => console.error('[Puffs Reader] Failed to record reading time:', error));
    }
    this.readingStatsLastTurnAt = keepSession ? now : 0;
  }

  private isReadingStatsActive(): boolean {
    return this.app.workspace.activeLeaf === this.leaf && document.hasFocus();
  }

  private getReadingStatsMinPageMs(): number {
    const value = Number(this.plugin.settings.readingStatsMinPageMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_READING_STATS_PAGE_MIN_MS;
  }

  private getReadingStatsIdleLimitMs(): number {
    const value = Number(this.plugin.settings.readingStatsIdleLimitMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_READING_STATS_IDLE_LIMIT_MS;
  }

  private getUncountedRanges(range: CountedRange, existing: CountedRange[]): CountedRange[] {
    let pending: CountedRange[] = [{ ...range }];
    const sorted = [...existing]
      .filter((item) => item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    for (const counted of sorted) {
      const next: CountedRange[] = [];
      for (const item of pending) {
        if (counted.end <= item.start || counted.start >= item.end) {
          next.push(item);
          continue;
        }
        if (counted.start > item.start) {
          next.push({ start: item.start, end: Math.min(counted.start, item.end) });
        }
        if (counted.end < item.end) {
          next.push({ start: Math.max(counted.end, item.start), end: item.end });
        }
      }
      pending = next;
      if (pending.length === 0) break;
    }
    return pending.filter((item) => item.end > item.start);
  }

  private countWordsInGlobalRanges(ranges: CountedRange[]): number {
    return ranges.reduce((sum, range) => sum + this.getTextInGlobalRange(range.start, range.end).replace(/\s+/g, '').length, 0);
  }

  private getTextInGlobalRange(startOffset: number, endOffset: number): string {
    const start = this.globalOffsetToPosition(startOffset);
    const end = this.globalOffsetToPosition(endOffset);
    const parts: string[] = [];
    for (let pi = start.paraIndex; pi <= end.paraIndex && pi < this.paragraphs.length; pi++) {
      const paragraph = this.paragraphs[pi] ?? '';
      const begin = pi === start.paraIndex ? start.charOffset : 0;
      const finish = pi === end.paraIndex ? end.charOffset : paragraph.length;
      if (finish > begin) parts.push(paragraph.slice(begin, finish));
    }
    return parts.join('\n');
  }

  private getReadChapterRangesForPage(start: ReaderPosition, end: ReaderPosition): ReadChapterRange[] {
    if (this.chapters.length === 0) {
      return [{ start: -1, end: -1, startTitle: '未识别章节', endTitle: '未识别章节' }];
    }

    const startPara = Math.max(0, Math.min(start.paraIndex, Math.max(0, this.paragraphs.length - 1)));
    const endPara = this.getVisiblePageEndParaIndex(start, end);
    const indices: number[] = [];
    for (let i = 0; i < this.chapters.length; i++) {
      const chapterStart = this.chapters[i].startParaIndex;
      const chapterEnd = this.chapters[i + 1]?.startParaIndex ?? this.paragraphs.length;
      if (chapterStart <= endPara && chapterEnd > startPara) indices.push(i);
    }

    if (indices.length === 0) {
      return [{ start: -1, end: -1, startTitle: '未识别章节', endTitle: '未识别章节' }];
    }

    const startIndex = indices[0];
    const endIndex = indices[indices.length - 1];
    return [{
      start: startIndex,
      end: endIndex,
      startTitle: this.chapters[startIndex].title,
      endTitle: this.chapters[endIndex].title,
    }];
  }

  private getVisiblePageEndParaIndex(start: ReaderPosition, end: ReaderPosition): number {
    if (this.paragraphs.length === 0) return 0;
    if (end.paraIndex >= this.paragraphs.length) return this.paragraphs.length - 1;
    if (end.charOffset === 0 && end.paraIndex > start.paraIndex) return end.paraIndex - 1;
    return Math.max(start.paraIndex, end.paraIndex);
  }

  private parseChapters(): void {
    this.chapters = [];
    this.collapsedTocGroups.clear();

    let regexes: RegExp[];
    try {
      regexes = this.getChapterMatchRegexes();
    } catch {
      return;
    }
    if (regexes.length === 0) return;

    for (let i = 0; i < this.paragraphs.length; i++) {
      const line = this.paragraphs[i].trim();
      if (line && regexes.some((regex) => regex.test(line))) {
        this.chapters.push({
          title: this.extractChapterTitle(line),
          rawTitle: line,
          startParaIndex: i,
          level: this.getTocIndentLevel(line),
        });
      }
    }
  }

  private getTocIndentLevel(line: string): number {
    const settings = this.getBookSettings();
    if (!settings.tocIndentEnabled) return 1;

    const marker = this.extractChapterMarker(line);
    if (!marker) return 1;

    try {
      const level1Regex = new RegExp(settings.tocIndentLevel1Regex?.trim() || '\u5377');
      const level2Regex = new RegExp(settings.tocIndentLevel2Regex?.trim() || '\u7ae0');
      const level3Regex = new RegExp(settings.tocIndentLevel3Regex?.trim() || '\u8282');
      if (level1Regex.test(marker)) return 1;
      if (level2Regex.test(marker)) return 2;
      if (level3Regex.test(marker)) return 3;
    } catch {
      return 1;
    }

    return 1;
  }

  private extractChapterMarker(line: string): string {
    const customRegex = this.getBookSettings().chapterTitleRegex ?? this.plugin.settings.chapterTitleRegex;
    try {
      const match = line.match(new RegExp(customRegex));
      return match?.[2]?.trim() ?? '';
    } catch {
      return '';
    }
  }

  private extractChapterTitle(line: string): string {
    const customRegex = this.getBookSettings().chapterTitleRegex ?? this.plugin.settings.chapterTitleRegex;
    try {
      const match = line.match(new RegExp(customRegex));
      if (match?.[1] && match?.[2] && /^[章节回卷集部篇]$/.test(match[2])) {
        const numberText = this.normalizeChapterNumber(match[1]);
        const titleText = (match[3] ?? '').trim();
        return titleText ? `第${numberText}${match[2]} ${titleText}` : `第${numberText}${match[2]}`;
      }
      const captured = match?.slice(1).find((part) => part && part.trim().length > 0)?.trim();
      if (captured) return captured;
    } catch {
      // 正则错误时回退原始章节行，避免目录消失。
    }
    try {
      const match = line.match(new RegExp(this.getEffectivePrologueTitleRegex()));
      const captured = match?.slice(1).find((part) => part && part.trim().length > 0)?.trim();
      if (captured) return captured;
      if (match) return line.trim();
    } catch {
      // 序章匹配错误时回退原始章节行。
    }
    return line;
  }

  private getChapterEndPara(paraIndex: number): number | null {
    const active = this.getActiveChapterIndex(paraIndex);
    if (active < 0) return null;
    return this.chapters[active + 1]?.startParaIndex ?? null;
  }

  private buildTocList(): void {
    if (!this.tocListEl) return;
    this.tocListEl.empty();
    if (this.chapters.length === 0) {
      this.tocListEl.createDiv({ cls: 'puffs-toc-empty', text: '未检测到章节' });
      return;
    }

    this.chapters.forEach((ch, index) => {
      if (this.isTocChildHidden(index)) return;

      const item = this.tocListEl.createDiv({ cls: 'puffs-toc-item' });
      item.dataset.chapterIndex = String(index);
      const displayLevel = this.getTocDisplayLevel(index);
      item.classList.add(`puffs-toc-level-${displayLevel}`);

      if (this.hasTocChildren(index)) {
        const toggle = item.createEl('button', {
          cls: 'puffs-toc-toggle',
          attr: { 'aria-label': this.collapsedTocGroups.has(index) ? '展开' : '收起' },
        });
        setIcon(toggle, this.collapsedTocGroups.has(index) ? 'chevron-right' : 'chevron-down');
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleTocGroup(index);
        });
      }

      item.createSpan({ cls: 'puffs-toc-item-title', text: ch.title });
      item.addEventListener('click', () => {
        this.jumpToPosition({ paraIndex: ch.startParaIndex, charOffset: 0 });
        this.applySidebarMode('toc');
      });
    });
  }

  private hasTocChildren(index: number): boolean {
    const level = this.chapters[index]?.level ?? 1;
    for (let i = index + 1; i < this.chapters.length; i++) {
      if (this.chapters[i].level <= level) return false;
      if (this.chapters[i].level > level) return true;
    }
    return false;
  }

  private isTocChildHidden(index: number): boolean {
    let parentIndex = this.getTocParentIndex(index);
    while (parentIndex !== null) {
      if (this.collapsedTocGroups.has(parentIndex)) return true;
      parentIndex = this.getTocParentIndex(parentIndex);
    }
    return false;
  }

  private getTocParentIndex(index: number): number | null {
    const level = this.chapters[index]?.level ?? 1;
    if (level <= 1) return null;
    for (let i = index - 1; i >= 0; i--) {
      if (this.chapters[i].level < level) return i;
    }
    return null;
  }

  private getTocDisplayLevel(index: number): number {
    let displayLevel = 1;
    let parentIndex = this.getTocParentIndex(index);
    while (parentIndex !== null) {
      displayLevel++;
      parentIndex = this.getTocParentIndex(parentIndex);
    }
    return Math.min(3, displayLevel);
  }

  private getVisibleTocIndex(index: number): number {
    let visibleIndex = index;
    let parentIndex = this.getTocParentIndex(index);
    while (parentIndex !== null) {
      if (this.collapsedTocGroups.has(parentIndex)) visibleIndex = parentIndex;
      parentIndex = this.getTocParentIndex(parentIndex);
    }
    return visibleIndex;
  }

  private toggleTocGroup(index: number): void {
    if (this.collapsedTocGroups.has(index)) this.collapsedTocGroups.delete(index);
    else this.collapsedTocGroups.add(index);
    this.buildTocList();
    this.highlightCurrentTocItem(this.getActiveChapterIndex(this.currentPageStart.paraIndex));
  }

  private updatePageMeta(): void {
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    if (this.plugin.settings.showChapterTitle) {
      this.chapterTitleEl.textContent = activeChapter >= 0 ? this.chapters[activeChapter].title : '';
      this.chapterTitleEl.classList.remove('puffs-hidden');
    } else {
      this.chapterTitleEl.classList.add('puffs-hidden');
    }
    this.highlightCurrentTocItem(activeChapter);

    if (this.plugin.settings.showProgress) {
      const current = Math.min(this.currentPageStart.paraIndex, this.paragraphs.length);
      const pct = this.paragraphs.length > 0 ? ((current / this.paragraphs.length) * 100).toFixed(1) : '0.0';
      this.progressTitleEl.textContent = `${pct}%`;
      this.progressTitleEl.classList.remove('puffs-hidden');
    } else {
      this.progressTitleEl.classList.add('puffs-hidden');
    }
  }

  private getActiveChapterIndex(paraIndex: number): number {
    let active = -1;
    for (let i = 0; i < this.chapters.length; i++) {
      if (this.chapters[i].startParaIndex <= paraIndex) active = i;
      else break;
    }
    return active;
  }

  private highlightCurrentTocItem(idx: number): void {
    const visibleIdx = this.getVisibleTocIndex(idx);
    this.tocListEl?.querySelectorAll<HTMLElement>('.puffs-toc-item').forEach((el) => {
      el.classList.toggle('puffs-toc-active', Number(el.dataset.chapterIndex) === visibleIdx);
    });
  }

  private toggleToc(): void {
    if (this.isTocOpen) {
      this.closeSidebar();
    } else {
      this.openSidebar('toc');
    }
  }

  private closeSidebar(): void {
    this.isTocOpen = false;
    this.tocSidebar.classList.add('puffs-hidden');
    this.readingArea.focus();
  }

  private openSidebar(mode: ReaderSidebarMode, searchQuery?: string): void {
    this.isTocOpen = true;
    this.tocSidebar.classList.remove('puffs-hidden');
    this.applySidebarMode(mode);
    if (mode === 'toc') {
      requestAnimationFrame(() => this.scrollTocToActiveChapter());
    } else if (mode === 'search') {
      if (searchQuery !== undefined) {
        this.setSearchInput(searchQuery);
      } else {
        this.clearSearchInput();
      }
      requestAnimationFrame(() => {
        this.searchInput.focus();
        if (searchQuery !== undefined) this.searchInput.select();
      });
    } else if (mode === 'notes') {
      this.renderNotesPane();
    } else if (mode === 'tags') {
      this.renderTagsPane();
    }
  }

  private toggleSearchMode(): void {
    this.openSidebar(this.sidebarMode === 'search' ? 'toc' : 'search');
  }

  private switchSidebarMode(mode: 'toc' | 'notes'): void {
    if (this.sidebarMode === mode) return;
    this.openSidebar(mode);
  }

  private applySidebarMode(mode: ReaderSidebarMode): void {
    this.sidebarMode = mode;
    const inSearch = mode === 'search';
    const inTags = mode === 'tags';
    this.tocTitleEl.textContent = inSearch ? '全书搜索' : inTags ? '书籍标签' : (this.currentFile?.basename ?? '目录');
    setIcon(this.tocModeBtn, inSearch ? 'list' : 'search');
    this.tocModeBtn.setAttribute('aria-label', inSearch ? '返回目录' : '全书搜索');
    this.tocModeBtn.removeAttribute('title');
    this.tagsBtn.classList.toggle('is-active', inTags);
    this.tagsBtn.setAttribute('aria-pressed', inTags ? 'true' : 'false');

    this.tocTabsEl.classList.toggle('puffs-hidden', inSearch || inTags);
    this.tocTabBtn.classList.toggle('puffs-toc-tab-active', mode === 'toc');
    this.notesTabBtn.classList.toggle('puffs-toc-tab-active', mode === 'notes');

    this.tocListEl.classList.toggle('puffs-hidden', mode !== 'toc');
    this.notesPaneEl.classList.toggle('puffs-hidden', mode !== 'notes');
    this.tagsPaneEl.classList.toggle('puffs-hidden', mode !== 'tags');
    this.searchPaneEl.classList.toggle('puffs-hidden', mode !== 'search');
  }

  private updateSidebarTitle(): void {
    if (!this.tocTitleEl || this.sidebarMode === 'search' || this.sidebarMode === 'tags') return;
    this.tocTitleEl.textContent = this.currentFile?.basename ?? '目录';
  }

  private scrollTocToActiveChapter(): void {
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    if (activeChapter < 0) return;

    const visibleChapter = this.getVisibleTocIndex(activeChapter);
    const item = this.tocListEl.querySelector<HTMLElement>(`.puffs-toc-item[data-chapter-index="${visibleChapter}"]`);
    if (!item) return;

    item.scrollIntoView({ block: 'center' });
  }

  private clearSearchInput(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.searchInput.value = '';
    this.searchInfoEl.textContent = '';
    this.searchResultsEl.empty();
    this.renderCurrentPage();
  }

  private setSearchInput(query: string): void {
    this.searchInput.value = query;
    window.clearTimeout(this.searchTimer);
    this.performSearch(query);
  }

  private performSearch(query: string): void {
    this.searchQuery = query.trim();
    this.searchResults = [];

    if (!this.searchQuery) {
      this.searchInfoEl.textContent = '';
      this.searchResultsEl.empty();
      this.renderCurrentPage();
      return;
    }

    const needle = this.searchQuery.toLowerCase();
    for (let pi = 0; pi < this.paragraphs.length; pi++) {
      const text = this.paragraphs[pi].toLowerCase();
      let offset = 0;
      while (true) {
        const found = text.indexOf(needle, offset);
        if (found === -1) break;
        this.searchResults.push({ paraIndex: pi, startOffset: found, length: needle.length });
        offset = found + Math.max(needle.length, 1);
      }
    }

    this.searchInfoEl.textContent = this.searchResults.length > 0
      ? `${this.searchResults.length} 个结果`
      : '无结果';
    this.renderSearchResults();
    this.renderCurrentPage();
  }

  private renderSearchResults(): void {
    this.searchResultsEl.empty();
    if (this.searchResults.length === 0) {
      this.searchResultsEl.createDiv({ cls: 'puffs-search-empty', text: '没有找到匹配内容' });
      return;
    }

    const seen = new Set<number>();
    const grouped = this.searchResults.filter((match) => {
      if (seen.has(match.paraIndex)) return false;
      seen.add(match.paraIndex);
      return true;
    }).slice(0, 200);

    grouped.forEach((match) => {
      const card = this.searchResultsEl.createDiv({ cls: 'puffs-search-card' });
      const chapter = this.getActiveChapterIndex(match.paraIndex);
      card.createDiv({
        cls: 'puffs-search-card-title',
        text: chapter >= 0 ? this.chapters[chapter].title : `第 ${match.paraIndex + 1} 段`,
      });
      const preview = card.createDiv({ cls: 'puffs-search-card-preview' });
      preview.innerHTML = this.buildSearchPreview(match);
      card.addEventListener('click', () => {
        this.searchJumpBackPos = { ...this.currentPageStart };
        this.searchJumpPageTurns = 0;
        this.searchBackBtn.classList.remove('puffs-hidden');
        this.jumpToPosition({ paraIndex: match.paraIndex, charOffset: match.startOffset });
      });
    });
  }

  private buildSearchPreview(match: SearchMatch): string {
    const text = this.paragraphs[match.paraIndex];
    const start = Math.max(0, match.startOffset - 56);
    const end = Math.min(text.length, match.startOffset + match.length + 56);
    const localStart = match.startOffset - start;
    const localEnd = localStart + match.length;
    const visible = text.slice(start, end);
    return `${start > 0 ? '...' : ''}${this.escapeHTML(visible.slice(0, localStart))}<mark>${this.escapeHTML(visible.slice(localStart, localEnd))}</mark>${this.escapeHTML(visible.slice(localEnd))}${end < text.length ? '...' : ''}`;
  }

  private returnFromSearchJump(): void {
    if (!this.searchJumpBackPos) return;
    const target = this.searchJumpBackPos;
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.searchBackBtn.classList.add('puffs-hidden');
    this.currentPageStart = this.clampPosition(target);
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }

  private recordPageTurnAfterSearchJump(): void {
    if (!this.searchJumpBackPos) return;
    this.searchJumpPageTurns += 1;
    if (this.searchJumpPageTurns >= 5) {
      this.clearSearchJumpAndHighlights();
    }
  }

  private clearSearchJumpAndHighlights(): void {
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.searchBackBtn.classList.add('puffs-hidden');
    this.clearSearchInput();
  }

  private refreshTypographyPanel(): void {
    const p = this.typographyPanel;
    p.empty();
    const bookSettings = this.getBookSettings();

    const title = p.createDiv({ cls: 'puffs-typo-title' });
    title.createSpan({ text: '书籍设置' });

    const encodingRow = p.createDiv({ cls: 'puffs-typo-row' });
    encodingRow.createSpan({ cls: 'puffs-typo-label', text: '编码方式' });
    this.encodingBtn = encodingRow.createEl('button', {
      cls: 'puffs-icon-btn puffs-encoding-btn',
      text: this.currentEncoding.toUpperCase(),
      attr: { 'aria-label': '切换编码' },
    });
    this.encodingBtn.addEventListener('click', (e) => this.showEncodingMenu(e));

    this.addNumberRow(
      p,
      '首行缩进',
      this.getEffectiveFirstLineIndent(),
      0,
      4,
      0.1,
      'em',
      (v) => {
        this.updateBookSettings({ firstLineIndent: v });
        this.applyTypography();
        this.renderCurrentPage();
      },
    );
    this.addTextRow(p, '目录正则', this.getEffectiveTocRegex(), (v) => {
      this.updateBookSettings({ tocRegex: v || undefined });
      this.parseChapters();
      this.buildTocList();
      this.renderCurrentPage();
    });
    this.addTextRow(p, '章名正则', bookSettings.chapterTitleRegex ?? this.plugin.settings.chapterTitleRegex, (v) => {
      this.updateBookSettings({ chapterTitleRegex: v || undefined });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addTextRow(p, '序章匹配', bookSettings.prologueTitleRegex ?? this.plugin.settings.prologueTitleRegex, (v) => {
      this.updateBookSettings({ prologueTitleRegex: v || undefined });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addToggleRow(p, '去除多余空行', this.getEffectiveRemoveExtraBlankLines(), (v) => {
      this.updateBookSettings({ removeExtraBlankLines: v });
      this.reprocessCurrentText(true);
    });

    this.addTocIndentRows(p, bookSettings);

    const exportRow = p.createDiv({ cls: 'puffs-typo-row' });
    exportRow.createSpan({ cls: 'puffs-typo-label', text: '标注与批注' });
    const exportBtn = exportRow.createEl('button', {
      cls: 'puffs-icon-btn',
      text: '导出 Markdown',
    });
    exportBtn.addEventListener('click', () => this.exportAnnotations());
  }

  private addNumberRow(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
    onChange: (v: number) => void,
  ): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });
    const input = row.createEl('input', {
      cls: 'puffs-typo-number',
      attr: { type: 'number', min: String(min), max: String(max), step: String(step) },
    }) as HTMLInputElement;
    input.value = String(value);
    row.createSpan({ cls: 'puffs-typo-unit', text: unit });
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (Number.isNaN(parsed)) return;
      const next = Math.min(max, Math.max(min, parsed));
      input.value = String(next);
      onChange(next);
    });
  }

  private addTextRow(parent: HTMLElement, label: string, value: string, onChange: (v: string) => void): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });
    const input = row.createEl('input', { cls: 'puffs-typo-text-input', attr: { type: 'text' } }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value.trim()));
  }

  private addToggleRow(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });
    const toggle = row.createEl('input', {
      cls: 'puffs-typo-toggle',
      attr: { type: 'checkbox' },
    }) as HTMLInputElement;
    toggle.checked = value;
    toggle.addEventListener('change', () => onChange(toggle.checked));
  }

  private addTocIndentRows(parent: HTMLElement, bookSettings: BookSettings): void {
    const enabled = !!bookSettings.tocIndentEnabled;
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: '\u76ee\u5f55\u7f29\u8fdb' });
    const toggle = row.createEl('input', {
      cls: 'puffs-typo-toggle',
      attr: { type: 'checkbox' },
    }) as HTMLInputElement;
    toggle.checked = enabled;
    toggle.addEventListener('change', () => {
      this.updateBookSettings({
        tocIndentEnabled: toggle.checked,
        tocIndentLevel1Regex: toggle.checked ? (bookSettings.tocIndentLevel1Regex?.trim() || '\u5377') : undefined,
        tocIndentLevel2Regex: toggle.checked ? (bookSettings.tocIndentLevel2Regex?.trim() || '\u7ae0') : undefined,
        tocIndentLevel3Regex: toggle.checked ? (bookSettings.tocIndentLevel3Regex?.trim() || '\u8282') : undefined,
      });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
      this.refreshTypographyPanel();
    });

    if (!enabled) return;

    this.addTextRow(parent, '1\u7ea7\u5173\u952e\u5b57\u6b63\u5219', bookSettings.tocIndentLevel1Regex ?? '\u5377', (v) => {
      this.updateBookSettings({ tocIndentLevel1Regex: v || '\u5377' });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addTextRow(parent, '2\u7ea7\u5173\u952e\u5b57\u6b63\u5219', bookSettings.tocIndentLevel2Regex ?? '\u7ae0', (v) => {
      this.updateBookSettings({ tocIndentLevel2Regex: v || '\u7ae0' });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addTextRow(parent, '3\u7ea7\u5173\u952e\u5b57\u6b63\u5219', bookSettings.tocIndentLevel3Regex ?? '\u8282', (v) => {
      this.updateBookSettings({ tocIndentLevel3Regex: v || '\u8282' });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
  }

  private applyTypography(): void {
    if (!this.rootEl || !this.contentContainer) return;

    const s = this.plugin.settings;
    const rgbBg = s.backgroundColor ? `rgb(${s.backgroundColor})` : '';
    const rgbFont = s.fontColor ? `rgb(${s.fontColor})` : '';
    const chapterColor = s.chapterMetaColor ? `rgb(${s.chapterMetaColor})` : '';
    const progressColor = s.progressMetaColor ? `rgb(${s.progressMetaColor})` : '';

    this.rootEl.style.setProperty('--puffs-bg-color', rgbBg || 'var(--background-primary)');
    this.readingArea.style.setProperty('--puffs-bg-color', rgbBg || 'var(--background-primary)');
    this.contentContainer.style.setProperty('--puffs-font-size', `${s.fontSize}px`);
    this.contentContainer.style.setProperty('--puffs-line-height', String(s.lineHeight));
    this.contentContainer.style.setProperty('--puffs-para-spacing', `${s.paragraphSpacing}px`);
    this.contentContainer.style.setProperty('--puffs-indent', `${this.getEffectiveFirstLineIndent()}em`);
    this.contentContainer.style.setProperty('--puffs-content-width', `${s.contentWidth}px`);
    this.contentContainer.style.setProperty('--puffs-letter-spacing', `${s.letterSpacing}px`);
    this.contentContainer.style.setProperty('--puffs-padding-top', `${s.paddingTop}px`);
    this.contentContainer.style.setProperty('--puffs-padding-bottom', `${s.paddingBottom}px`);
    this.rootEl.style.setProperty('--puffs-sidebar-width', `${s.sidebarWidth}px`);
    this.rootEl.style.setProperty('--puffs-sidebar-transition', `${s.sidebarTransitionMs}ms`);
    this.rootEl.style.setProperty('--puffs-toc-font-size', `${s.tocFontSize}px`);
    this.rootEl.style.setProperty('--puffs-sidebar-title-size', `${s.sidebarTitleFontSize ?? 16}px`);
    this.rootEl.style.setProperty('--puffs-chapter-meta-size', `${s.chapterMetaFontSize}px`);
    this.rootEl.style.setProperty('--puffs-chapter-meta-top', `${s.chapterMetaTop}px`);
    this.rootEl.style.setProperty('--puffs-progress-meta-size', `${s.progressMetaFontSize}px`);
    this.rootEl.style.setProperty('--puffs-progress-meta-bottom', `${s.progressMetaBottom}px`);

    if (rgbFont) this.contentContainer.style.setProperty('--puffs-font-color', rgbFont);
    else this.contentContainer.style.removeProperty('--puffs-font-color');

    const annoBg = s.annotationHighlightColor ? `rgba(${s.annotationHighlightColor},0.42)` : '';
    if (annoBg) this.rootEl.style.setProperty('--puffs-anno-bg', annoBg);
    else this.rootEl.style.removeProperty('--puffs-anno-bg');
    if (chapterColor) this.rootEl.style.setProperty('--puffs-chapter-meta-color', chapterColor);
    else this.rootEl.style.removeProperty('--puffs-chapter-meta-color');
    if (progressColor) this.rootEl.style.setProperty('--puffs-progress-meta-color', progressColor);
    else this.rootEl.style.removeProperty('--puffs-progress-meta-color');
  }

  private toggleTypography(): void {
    if (this.isTypographyOpen) this.closeTypography();
    else {
      this.isTypographyOpen = true;
      this.refreshTypographyPanel();
      this.typographyPanel.classList.remove('puffs-hidden');
    }
  }

  private closeTypography(): void {
    this.isTypographyOpen = false;
    this.typographyPanel.classList.add('puffs-hidden');
  }

  private closePanelsOnOutsideClick(e: PointerEvent): void {
    const target = e.target as Node | null;
    if (!target) return;
    if (this.isTypographyOpen && !this.typographyPanel.contains(target) && !this.settingsBtn.contains(target)) {
      this.closeTypography();
    }
    if (this.isTocOpen && !this.tocSidebar.contains(target)) {
      this.closeSidebar();
    }
  }

  private getBookSettings(): BookSettings {
    if (!this.currentFile) return {};
    return this.plugin.getBookSettings(this.currentFile.path);
  }

  private getEffectiveFirstLineIndent(): number {
    return this.getBookSettings().firstLineIndent ?? this.plugin.settings.firstLineIndent;
  }

  private getEffectiveTocRegex(): string {
    return this.getBookSettings().tocRegex ?? this.plugin.settings.tocRegex;
  }

  private getEffectivePrologueTitleRegex(): string {
    return this.getBookSettings().prologueTitleRegex ?? this.plugin.settings.prologueTitleRegex;
  }

  private getEffectiveRemoveExtraBlankLines(): boolean {
    return this.getBookSettings().removeExtraBlankLines ?? this.plugin.settings.removeExtraBlankLines;
  }

  private getChapterMatchRegexes(): RegExp[] {
    return [this.getEffectiveTocRegex(), this.getEffectivePrologueTitleRegex()]
      .map((regexText) => regexText.trim())
      .filter((regexText) => regexText.length > 0)
      .map((regexText) => new RegExp(regexText));
  }

  private normalizeChapterNumber(raw: string): string {
    if (/^\d+$/.test(raw)) return String(Number(raw));
    const parsed = this.parseChineseNumber(raw);
    return parsed > 0 ? String(parsed) : raw;
  }

  private getChapterStartingAt(paraIndex: number): Chapter | null {
    return this.chapters.find((chapter) => chapter.startParaIndex === paraIndex) ?? null;
  }

  private parseChineseNumber(raw: string): number {
    const digits: Record<string, number> = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    const smallUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
    const largeUnits: Record<string, number> = { 万: 10000, 亿: 100000000 };

    // 位值写法检测：所有字符都是单字数字且长度>=2且不含"十百千万亿"
    const allDigits = [...raw].every((ch) => ch in digits);
    if (allDigits && raw.length >= 2) {
      let result = 0;
      for (const ch of raw) {
        result = result * 10 + digits[ch];
      }
      return result;
    }

    let total = 0;
    let section = 0;
    let number = 0;

    for (const char of raw) {
      if (char in digits) {
        number = digits[char];
      } else if (char in smallUnits) {
        section += (number || 1) * smallUnits[char];
        number = 0;
      } else if (char in largeUnits) {
        section += number;
        total += (section || 1) * largeUnits[char];
        section = 0;
        number = 0;
      } else {
        return 0;
      }
    }

    return total + section + number;
  }

  private updateBookSettings(partial: BookSettings): void {
    if (!this.currentFile) return;
    const next = {
      ...this.getBookSettings(),
      ...partial,
    };
    this.plugin.saveBookSettings(this.currentFile.path, next);
  }

  // ═══════════════════════════ 书籍标签 ═══════════════════════════

  private getBookTags(): BookTags {
    if (!this.currentFile) return { genre: [], feature: [], accumulation: [] };
    return this.plugin.getBookTags(this.currentFile.path);
  }

  private async saveBookTags(tags: BookTags): Promise<void> {
    if (!this.currentFile) return;
    await this.plugin.saveBookTags(this.currentFile.path, tags);
    if (this.isTocOpen && this.sidebarMode === 'tags') this.renderTagsPane();
  }

  private renderTagsPane(): void {
    if (!this.tagsPaneEl) return;
    this.tagsPaneEl.empty();
    if (!this.currentFile) {
      this.tagsPaneEl.createDiv({ cls: 'puffs-search-empty', text: '当前没有打开书籍' });
      return;
    }

    const catalog = this.plugin.getTagCatalog();
    const tags = this.getBookTags();
    this.renderTagChipSection(
      this.tagsPaneEl,
      '题材',
      this.mergeTagOptions(catalog.genre, tags.genre),
      new Set(tags.genre),
      (tag) => this.toggleBookTag('genre', tag),
      '添加题材',
      (value) => this.addCustomTag('genre', value),
    );
    this.renderTagChipSection(
      this.tagsPaneEl,
      '状态',
      this.mergeTagOptions(catalog.status, tags.status ? [tags.status] : []),
      new Set(tags.status ? [tags.status] : []),
      (tag) => this.setBookStatusTag(tag),
      '添加状态',
      (value) => this.addCustomStatusTag(value),
    );
    this.renderTagChipSection(
      this.tagsPaneEl,
      '特色',
      this.mergeTagOptions(catalog.feature, tags.feature),
      new Set(tags.feature),
      (tag) => this.toggleBookTag('feature', tag),
      '添加特色',
      (value) => this.addCustomTag('feature', value),
    );
    this.renderAccumulationTagSection(this.tagsPaneEl, catalog.feature, tags);
  }

  private renderTagChipSection(
    parent: HTMLElement,
    title: string,
    options: string[],
    selected: Set<string>,
    onToggle: (tag: string) => void | Promise<void>,
    placeholder: string,
    onAdd: (value: string) => void | Promise<void>,
  ): void {
    const section = parent.createDiv({ cls: 'puffs-tag-section' });
    section.createDiv({ cls: 'puffs-tag-section-title', text: title });
    const chips = section.createDiv({ cls: 'puffs-tag-chip-row' });
    for (const option of options) {
      const chip = chips.createEl('button', {
        cls: selected.has(option) ? 'puffs-tag-chip is-active' : 'puffs-tag-chip',
        text: option,
      });
      chip.addEventListener('click', () => {
        Promise.resolve(onToggle(option)).catch((error) => console.error('[Puffs Reader] Failed to toggle tag:', error));
      });
    }
    this.renderCustomTagInput(section, placeholder, onAdd);
  }

  private renderAccumulationTagSection(parent: HTMLElement, options: string[], tags: BookTags): void {
    const selected = new Set(tags.accumulation.map((tag) => tag.name));
    const section = parent.createDiv({ cls: 'puffs-tag-section' });
    section.createDiv({ cls: 'puffs-tag-section-title', text: '积累情况' });
    const chips = section.createDiv({ cls: 'puffs-tag-chip-row' });
    for (const option of this.mergeTagOptions(options, tags.accumulation.map((tag) => tag.name))) {
      const chip = chips.createEl('button', {
        cls: selected.has(option) ? 'puffs-tag-chip is-active' : 'puffs-tag-chip',
        text: option,
      });
      chip.addEventListener('click', () => {
        this.toggleAccumulationTag(option)
          .catch((error) => console.error('[Puffs Reader] Failed to toggle accumulation tag:', error));
      });
    }
    this.renderCustomTagInput(section, '添加积累项', (value) => this.addCustomAccumulationTag(value));

    if (tags.accumulation.length === 0) {
      section.createDiv({ cls: 'puffs-tag-empty', text: '未选择积累项' });
      return;
    }

    const list = section.createDiv({ cls: 'puffs-tag-accumulation-list' });
    for (const item of tags.accumulation) {
      const row = list.createDiv({ cls: 'puffs-tag-accumulation-row' });
      row.createSpan({ cls: 'puffs-tag-accumulation-name', text: item.name });
      const startInput = row.createEl('input', {
        cls: 'puffs-tag-range-input',
        attr: { type: 'number', min: '1', step: '1', placeholder: '起' },
      }) as HTMLInputElement;
      startInput.value = item.startChapter ? String(item.startChapter) : '';
      row.createSpan({ cls: 'puffs-tag-range-separator', text: '-' });
      const endInput = row.createEl('input', {
        cls: 'puffs-tag-range-input',
        attr: { type: 'number', min: '1', step: '1', placeholder: '止' },
      }) as HTMLInputElement;
      endInput.value = item.endChapter ? String(item.endChapter) : '';
      const saveRange = () => {
        this.updateAccumulationRange(item.name, startInput.value, endInput.value)
          .catch((error) => console.error('[Puffs Reader] Failed to update accumulation range:', error));
      };
      startInput.addEventListener('change', saveRange);
      endInput.addEventListener('change', saveRange);
    }
  }

  private renderCustomTagInput(parent: HTMLElement, placeholder: string, onAdd: (value: string) => void | Promise<void>): void {
    const row = parent.createDiv({ cls: 'puffs-tag-custom-row' });
    const input = row.createEl('input', {
      cls: 'puffs-tag-custom-input',
      attr: { type: 'text', placeholder },
    }) as HTMLInputElement;
    const addBtn = row.createEl('button', { cls: 'puffs-tag-add-btn', text: '添加' });
    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      input.value = '';
      Promise.resolve(onAdd(value)).catch((error) => console.error('[Puffs Reader] Failed to add tag:', error));
    };
    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
  }

  private mergeTagOptions(base: string[], extra: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of [...base, ...extra]) {
      const tag = this.normalizeTagName(value);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
    }
    return result;
  }

  private normalizeTagName(value: string): string {
    return value.trim();
  }

  private normalizeAccumulationTagName(value: string): string {
    return this.normalizeTagName(value).replace(/^已积累/, '').trim();
  }

  private async addCustomTag(group: EditableTagArrayGroup, rawValue: string): Promise<void> {
    const value = await this.plugin.addTagCatalogItem(group, rawValue);
    if (!value) return;
    await this.addBookTag(group, value);
  }

  private async addCustomStatusTag(rawValue: string): Promise<void> {
    const value = await this.plugin.addTagCatalogItem('status', rawValue);
    if (!value) return;
    await this.setBookStatusTag(value);
  }

  private async addCustomAccumulationTag(rawValue: string): Promise<void> {
    const value = await this.plugin.addTagCatalogItem('feature', this.normalizeAccumulationTagName(rawValue));
    if (!value) return;
    const tags = this.getBookTags();
    if (!tags.accumulation.some((tag) => tag.name === value)) {
      await this.saveBookTags({
        ...tags,
        accumulation: [...tags.accumulation, { name: value }],
      });
    } else {
      this.renderTagsPane();
    }
  }

  private async addBookTag(group: EditableTagArrayGroup, tag: string): Promise<void> {
    const tags = this.getBookTags();
    const current = tags[group];
    if (current.includes(tag)) {
      this.renderTagsPane();
      return;
    }
    await this.saveBookTags({ ...tags, [group]: [...current, tag] });
  }

  private async toggleBookTag(group: EditableTagArrayGroup, tag: string): Promise<void> {
    const tags = this.getBookTags();
    const selected = new Set(tags[group]);
    if (selected.has(tag)) selected.delete(tag);
    else selected.add(tag);
    await this.saveBookTags({ ...tags, [group]: Array.from(selected) });
  }

  private async setBookStatusTag(tag: string): Promise<void> {
    const tags = this.getBookTags();
    await this.saveBookTags({
      ...tags,
      status: tags.status === tag ? undefined : tag,
    });
  }

  private async toggleAccumulationTag(tag: string): Promise<void> {
    const tags = this.getBookTags();
    const exists = tags.accumulation.some((item) => item.name === tag);
    await this.saveBookTags({
      ...tags,
      accumulation: exists
        ? tags.accumulation.filter((item) => item.name !== tag)
        : [...tags.accumulation, { name: tag }],
    });
  }

  private async updateAccumulationRange(name: string, rawStart: string, rawEnd: string): Promise<void> {
    const startChapter = this.parseOptionalChapter(rawStart);
    const endChapter = this.parseOptionalChapter(rawEnd);
    if (startChapter === null || endChapter === null) {
      new Notice('章节范围必须是正整数');
      this.renderTagsPane();
      return;
    }
    if (startChapter !== undefined && endChapter !== undefined && endChapter < startChapter) {
      new Notice('结束章节不能小于起始章节');
      this.renderTagsPane();
      return;
    }
    const tags = this.getBookTags();
    await this.saveBookTags({
      ...tags,
      accumulation: tags.accumulation.map((item) => item.name === name
        ? {
            name: item.name,
            ...(startChapter !== undefined ? { startChapter } : {}),
            ...(endChapter !== undefined ? { endChapter } : {}),
          }
        : item),
    });
  }

  private parseOptionalChapter(value: string): number | undefined | null {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  private bindGlobalKeys(): void {
    this.boundGlobalKeydown = (e: KeyboardEvent) => {
      if (!this.contentEl.isConnected) return;
      if (e.key === 'Escape') {
        if (!this.isReaderKeyboardActive()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (this.matchesSearchHotkey(e)) {
        if (!this.shouldHandleSearchHotkey()) return;
        e.preventDefault();
        e.stopPropagation();
        this.toggleSearchFromHotkey();
        return;
      }
      if (this.matchesTocPanelHotkey(e)) {
        if (!this.shouldHandleSearchHotkey()) return;
        e.preventDefault();
        e.stopPropagation();
        this.toggleToc();
        return;
      }
      if (this.matchesCopySourceHotkey(e)) {
        if (!this.shouldHandleCopySourceHotkey(e)) return;
        e.preventDefault();
        e.stopPropagation();
        this.openChapterCopyModal();
      }
    };
    document.addEventListener('keydown', this.boundGlobalKeydown, true);
    window.addEventListener('keydown', this.boundGlobalKeydown, true);
  }

  private bindCursorAutoHide(): void {
    this.boundMouseMove = () => {
      if (!this.contentEl.isConnected) return;
      this.resetCursorIdleState();
    };
    document.addEventListener('mousemove', this.boundMouseMove, true);
  }

  private resetCursorIdleState(): void {
    this.showCursor();
    this.clearCursorHideTimer();
    if (!this.shouldAutoHideCursor()) return;

    this.cursorHideTimer = window.setTimeout(() => {
      if (this.shouldAutoHideCursor()) {
        this.rootEl?.classList.add('puffs-cursor-hidden');
      }
    }, this.plugin.settings.cursorHideDelayMs);
  }

  private shouldAutoHideCursor(): boolean {
    return (
      this.app.workspace.activeLeaf === this.leaf &&
      this.contentEl.isConnected &&
      this.plugin.settings.cursorHideDelayMs > 0
    );
  }

  private showCursor(): void {
    this.rootEl?.classList.remove('puffs-cursor-hidden');
  }

  private clearCursorHideTimer(): void {
    window.clearTimeout(this.cursorHideTimer);
    this.cursorHideTimer = 0;
  }

  private matchesHotkey(e: KeyboardEvent, raw: string): boolean {
    const parts = raw.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
    const key = parts.find((p) => !['ctrl', 'control', 'cmd', 'meta', 'alt', 'shift'].includes(p));
    if (!key) return false;
    const eventKey = e.key.toLowerCase();
    const eventCode = e.code.toLowerCase().replace(/^key/, '');
    return (
      (eventKey === key || eventCode === key) &&
      e.ctrlKey === (parts.includes('ctrl') || parts.includes('control')) &&
      e.metaKey === (parts.includes('cmd') || parts.includes('meta')) &&
      e.altKey === parts.includes('alt') &&
      e.shiftKey === parts.includes('shift')
    );
  }

  private matchesSearchHotkey(e: KeyboardEvent): boolean {
    return this.matchesHotkey(e, this.plugin.settings.searchHotkey || 'Ctrl+F');
  }

  private matchesTocPanelHotkey(e: KeyboardEvent): boolean {
    return this.matchesHotkey(e, this.plugin.settings.tocPanelHotkey || 'Ctrl+B');
  }

  private matchesCopySourceHotkey(e: KeyboardEvent): boolean {
    return this.matchesHotkey(e, this.plugin.settings.copySourceHotkey || 'Ctrl+Shift+C');
  }

  private matchesPreviousPageHotkey(e: KeyboardEvent): boolean {
    return this.matchesHotkey(e, this.plugin.settings.previousPageHotkey || 'j');
  }

  private matchesNextPageHotkey(e: KeyboardEvent): boolean {
    return this.matchesHotkey(e, this.plugin.settings.nextPageHotkey || 'l');
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (this.matchesCopySourceHotkey(e)) {
      if (!this.shouldHandleCopySourceHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.openChapterCopyModal();
      return;
    }
    if (this.matchesSearchHotkey(e)) {
      e.preventDefault();
      this.toggleSearchFromHotkey();
      return;
    }
    if (this.matchesTocPanelHotkey(e)) {
      e.preventDefault();
      this.toggleToc();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      const sel = this.captureSelection();
      if (sel) {
        e.preventDefault();
        this.spacePressedSelection = sel;
        this.spaceHoldFired = false;
        window.clearTimeout(this.spaceHoldTimer);
        this.spaceHoldTimer = window.setTimeout(() => {
          this.spaceHoldFired = true;
          if (this.spacePressedSelection) {
            this.openAnnotationModal(this.spacePressedSelection);
          }
        }, 300);
      }
      return;
    }
    if (this.isEditableTarget(e.target)) return;
    if (e.key === 'ArrowRight' || this.matchesNextPageHotkey(e)) {
      e.preventDefault();
      this.tryManualPageTurn('next');
    } else if (e.key === 'ArrowLeft' || this.matchesPreviousPageHotkey(e)) {
      e.preventDefault();
      this.tryManualPageTurn('previous');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }

  private handleKeyup(e: KeyboardEvent): void {
    if (e.key !== ' ' && e.code !== 'Space') return;
    window.clearTimeout(this.spaceHoldTimer);
    const sel = this.spacePressedSelection;
    const fired = this.spaceHoldFired;
    this.spacePressedSelection = null;
    this.spaceHoldFired = false;
    if (sel && !fired) {
      e.preventDefault();
      this.addAnnotation(sel, undefined);
    }
  }

  private isReaderKeyboardActive(): boolean {
    const active = document.activeElement;
    return this.app.workspace.activeLeaf === this.leaf || !!active && this.contentEl.contains(active);
  }

  private shouldHandleSearchHotkey(): boolean {
    const active = document.activeElement;
    return this.app.workspace.activeLeaf === this.leaf && !!active && this.contentEl.contains(active);
  }

  private shouldHandleCopySourceHotkey(e: KeyboardEvent): boolean {
    return this.app.workspace.activeLeaf === this.leaf && !this.isEditableTarget(e.target);
  }

  private openChapterCopyModal(): void {
    if (this.chapterCopyModal) return;
    const choices = this.getCopyableChapterChoices();
    if (choices.length === 0) {
      new Notice('未检测到可复制的章节');
      return;
    }

    const currentChapter = Math.max(0, this.getActiveChapterIndex(this.currentPageStart.paraIndex));
    const initialChoiceIndex = this.getInitialCopyChoiceIndex(choices, currentChapter);
    const modal = new ChapterRangeCopyModal(
      this.app,
      choices,
      initialChoiceIndex,
      (startIndex, endIndex) => this.getChapterRangeWordCount(startIndex, endIndex),
      (startIndex, endIndex, chunkSize) => this.getFirstBatchChapterRangeWordCount(startIndex, endIndex, chunkSize),
      async (startIndex, endIndex, chunkSize) => this.splitChapterRanges(startIndex, endIndex, chunkSize),
      () => {
        if (this.chapterCopyModal === modal) this.chapterCopyModal = null;
      },
    );
    this.chapterCopyModal = modal;
    modal.open();
  }

  private getCopyableChapterChoices(): ChapterChoice[] {
    const hasNestedToc = this.chapters.some((chapter) => chapter.level > 1);
    const choices: ChapterChoice[] = [];
    this.chapters.forEach((chapter, index) => {
      if (hasNestedToc && this.hasTocChildren(index)) return;
      choices.push({
        chapter,
        index,
        displayTitle: hasNestedToc ? this.getChapterPathTitle(index) : chapter.title,
      });
    });
    return choices;
  }

  private getInitialCopyChoiceIndex(choices: ChapterChoice[], activeChapterIndex: number): number {
    const exact = choices.findIndex((choice) => choice.index === activeChapterIndex);
    if (exact >= 0) return choices[exact].index;
    const next = choices.find((choice) => choice.index > activeChapterIndex);
    return (next ?? choices[choices.length - 1]).index;
  }

  private async splitChapterRanges(startIndex: number, endIndex: number, chunkSize: number | null): Promise<boolean> {
    const segments = chunkSize === null
      ? [[startIndex, endIndex] as [number, number]]
      : this.buildBatchChapterSegments(startIndex, endIndex, chunkSize);
    if (segments.length === 0) {
      new Notice('拆分失败：章节范围无效');
      return false;
    }

    for (let i = 0; i < segments.length; i++) {
      const [segmentStart, segmentEnd] = segments[i];
      const text = this.getChapterRangeText(segmentStart, segmentEnd);
      if (text === null) return false;
      if (chunkSize === null && i === 0) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          new Notice('复制失败：无法写入剪贴板');
          return false;
        }
      }
      const ok = await this.writeChapterRangeText(segmentStart, segmentEnd, text);
      if (!ok) return false;
    }
    return true;
  }

  private getChapterRangeWordCount(startIndex: number, endIndex: number): number | null {
    const text = this.getChapterRangeText(startIndex, endIndex, false);
    return text === null ? null : text.replace(/\s+/g, '').length;
  }

  private getFirstBatchChapterRangeWordCount(startIndex: number, endIndex: number, chunkSize: number): number | null {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) return null;
    const first = this.buildBatchChapterSegments(startIndex, endIndex, chunkSize)[0];
    return first ? this.getChapterRangeWordCount(first[0], first[1]) : null;
  }

  private getChapterRangeText(startIndex: number, endIndex: number, showNotice = true): string | null {
    const start = this.chapters[startIndex];
    const end = this.chapters[endIndex];
    if (!start || !end) {
      if (showNotice) new Notice('复制失败：章节范围无效');
      return null;
    }
    if (endIndex < startIndex) {
      if (showNotice) new Notice('结束章节不能早于起始章节');
      return null;
    }

    const endParaIndex = this.chapters[endIndex + 1]?.startParaIndex ?? this.paragraphs.length;
    return this.paragraphs.slice(start.startParaIndex, endParaIndex).join('\n');
  }

  private buildBatchChapterSegments(startIndex: number, endIndex: number, chunkSize: number): Array<[number, number]> {
    const choices = this.getCopyableChapterChoices().filter((choice) => choice.index >= startIndex && choice.index <= endIndex);
    const segments: Array<[number, number]> = [];
    let pos = 0;

    while (pos < choices.length) {
      const parentIndex = this.getChapterParentIndex(choices[pos].index);
      let groupEnd = pos;
      while (
        groupEnd + 1 < choices.length &&
        this.getChapterParentIndex(choices[groupEnd + 1].index) === parentIndex
      ) {
        groupEnd++;
      }

      while (pos <= groupEnd) {
        const target = Math.min(pos + chunkSize - 1, groupEnd);
        segments.push([choices[pos].index, choices[target].index]);
        pos = target + 1;
      }
    }

    return segments;
  }

  private async writeChapterRangeText(startIndex: number, endIndex: number, text: string): Promise<boolean> {
    if (!this.currentFile) {
      new Notice('保存失败：当前书籍文件无效');
      return false;
    }

    try {
      const baseDir = (this.plugin.settings.breakdownTextDir || DEFAULT_SETTINGS.breakdownTextDir)
        .trim()
        .replace(/^\/+|\/+$/g, '');
      const bookName = this.sanitizePathComponent(this.currentFile.basename);
      const targetDir = normalizePath(baseDir ? `${baseDir}/${bookName}` : bookName);
      await this.ensureVaultFolder(targetDir);

      const fileName = this.buildChapterRangeFileName(bookName, startIndex, endIndex);
      await this.app.vault.adapter.write(normalizePath(`${targetDir}/${fileName}`), text);
      return true;
    } catch {
      new Notice('保存失败：无法创建拆书文本文件');
      return false;
    }
  }

  private buildChapterRangeFileName(bookName: string, startIndex: number, endIndex: number): string {
    const parts = [bookName, ...this.getChapterRangeTitleParts(startIndex, endIndex)];
    return `${parts.map((part) => this.sanitizePathComponent(part)).join('-')}.txt`;
  }

  private getChapterRangeTitleParts(startIndex: number, endIndex: number): string[] {
    const startPath = this.getChapterPathTitles(startIndex);
    const endPath = this.getChapterPathTitles(endIndex);
    const startAncestors = startPath.slice(0, -1);
    const endAncestors = endPath.slice(0, -1);
    let commonAncestorCount = 0;
    while (
      commonAncestorCount < startAncestors.length &&
      commonAncestorCount < endAncestors.length &&
      startAncestors[commonAncestorCount] === endAncestors[commonAncestorCount]
    ) {
      commonAncestorCount++;
    }
    return [
      ...startPath.slice(0, commonAncestorCount),
      ...startPath.slice(commonAncestorCount),
      ...endPath.slice(commonAncestorCount),
    ];
  }

  private getChapterPathTitle(chapterIndex: number): string {
    return this.getChapterPathTitles(chapterIndex).join('-');
  }

  private getChapterPathTitles(chapterIndex: number): string[] {
    return [...this.getChapterAncestorIndices(chapterIndex), chapterIndex]
      .map((index) => this.chapters[index]?.title)
      .filter((title): title is string => !!title);
  }

  private getChapterAncestorIndices(chapterIndex: number): number[] {
    const ancestors: number[] = [];
    let parentIndex = this.getChapterParentIndex(chapterIndex);
    while (parentIndex !== null) {
      ancestors.unshift(parentIndex);
      parentIndex = this.getChapterParentIndex(parentIndex);
    }
    return ancestors;
  }

  private getChapterParentIndex(chapterIndex: number): number | null {
    const level = this.chapters[chapterIndex]?.level ?? 1;
    if (level <= 1) return null;
    for (let i = chapterIndex - 1; i >= 0; i--) {
      if (this.chapters[i].level < level) return i;
    }
    return null;
  }

  private sanitizePathComponent(value: string): string {
    const sanitized = value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim();
    return sanitized || '未命名';
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

  private scheduleProgressSave(): void {
    window.clearTimeout(this.progressSaveTimer);
    this.progressSaveTimer = window.setTimeout(() => this.saveProgressNow(), 800);
  }

  private saveProgressNow(): void {
    if (!this.currentFile || this.paragraphs.length === 0) return;
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: this.currentPageStart.paraIndex,
      charOffset: this.currentPageStart.charOffset,
      lastRead: Date.now(),
    });
  }

  private buildHighlightedHTML(text: string, matches: SearchMatch[]): string {
    const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset);
    let result = '';
    let last = 0;
    for (const m of sorted) {
      if (m.startOffset < last) continue;
      result += this.escapeHTML(text.slice(last, m.startOffset));
      result += `<span class="puffs-search-hl">${this.escapeHTML(text.slice(m.startOffset, m.startOffset + m.length))}</span>`;
      last = m.startOffset + m.length;
    }
    result += this.escapeHTML(text.slice(last));
    return result;
  }

  private escapeHTML(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ═══════════════════════════ 标注 / 批注 ═══════════════════════════

  private getAnnotations(): Annotation[] {
    return this.getBookSettings().annotations ?? [];
  }

  private async setAnnotations(next: Annotation[]): Promise<void> {
    if (!this.currentFile) return;
    const merged = { ...this.getBookSettings(), annotations: next };
    await this.plugin.saveBookSettings(this.currentFile.path, merged);
    if (this.isTocOpen && this.sidebarMode === 'notes') {
      this.renderNotesPane();
    }
  }

  private renderNotesPane(): void {
    if (!this.notesPaneEl) return;
    this.notesPaneEl.empty();
    const annos = [...this.getAnnotations()]
      .map((a, idx) => ({ a, idx }))
      .sort((x, y) => x.a.paraIndex - y.a.paraIndex || x.a.startOffset - y.a.startOffset);
    if (annos.length === 0) {
      this.notesPaneEl.createDiv({ cls: 'puffs-search-empty', text: '当前书没有标注或批注' });
      return;
    }

    annos.forEach(({ a, idx }) => {
      const card = this.notesPaneEl.createDiv({ cls: 'puffs-search-card puffs-note-card' });
      const head = card.createDiv({ cls: 'puffs-note-card-head' });
      const chapter = this.getActiveChapterIndex(a.paraIndex);
      head.createDiv({
        cls: 'puffs-search-card-title puffs-note-card-title',
        text: chapter >= 0 ? this.chapters[chapter].title : `第 ${a.paraIndex + 1} 段`,
      });
      const closeBtn = head.createEl('button', {
        cls: 'puffs-note-card-close',
        text: '×',
        attr: { 'aria-label': '删除' },
      });
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = this.getAnnotations().filter((_, i) => i !== idx);
        await this.setAnnotations(next);
        this.renderCurrentPage();
      });

      if (a.note) {
        card.createDiv({ cls: 'puffs-note-card-note', text: `批注：${a.note}` });
      }
      const preview = card.createDiv({ cls: 'puffs-search-card-preview puffs-note-card-preview' });
      this.renderAnnotationPreview(preview, a.text);

      card.addEventListener('click', () => {
        this.jumpToPosition({ paraIndex: a.paraIndex, charOffset: a.startOffset });
      });
    });
  }

  private getAnnotationEnd(annotation: Annotation): ReaderPosition {
    if (
      Number.isFinite(annotation.endParaIndex) &&
      Number.isFinite(annotation.endOffset) &&
      annotation.endParaIndex !== undefined &&
      annotation.endOffset !== undefined
    ) {
      return {
        paraIndex: annotation.endParaIndex,
        charOffset: annotation.endOffset,
      };
    }
    return {
      paraIndex: annotation.paraIndex,
      charOffset: annotation.startOffset + annotation.length,
    };
  }

  private getAnnotationSegment(
    annotation: Annotation,
    paraIndex: number,
  ): { startOffset: number; endOffset: number } | null {
    const end = this.getAnnotationEnd(annotation);
    if (paraIndex < annotation.paraIndex || paraIndex > end.paraIndex) return null;

    const paragraphLength = this.paragraphs[paraIndex]?.length ?? 0;
    const rawStart = paraIndex === annotation.paraIndex ? annotation.startOffset : 0;
    const rawEnd = paraIndex === end.paraIndex ? end.charOffset : paragraphLength;
    const startOffset = Math.max(0, Math.min(rawStart, paragraphLength));
    const endOffset = Math.max(0, Math.min(rawEnd, paragraphLength));
    if (endOffset <= startOffset) return null;
    return { startOffset, endOffset };
  }

  /**
   * 把当前选区解析为原文段落坐标。支持同一页内的跨段落选区。
   */
  private captureSelection(): AnnotationSelection | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!this.contentContainer.contains(range.startContainer) || !this.contentContainer.contains(range.endContainer)) {
      return null;
    }
    const startPara = this.findParaElement(range.startContainer);
    const endPara = this.findParaElement(range.endContainer);
    if (!startPara || !endPara) return null;

    const paraIndex = Number(startPara.dataset.paraIndex);
    const endParaIndex = Number(endPara.dataset.paraIndex);
    const startBaseOffset = Number(startPara.dataset.charOffset);
    const endBaseOffset = Number(endPara.dataset.charOffset);
    if (
      !Number.isFinite(paraIndex) ||
      !Number.isFinite(endParaIndex) ||
      !Number.isFinite(startBaseOffset) ||
      !Number.isFinite(endBaseOffset)
    ) return null;

    const startOffset = startBaseOffset + this.nodeOffsetToTextOffset(startPara, range.startContainer, range.startOffset);
    const endOffset = endBaseOffset + this.nodeOffsetToTextOffset(endPara, range.endContainer, range.endOffset);
    const startPos = this.clampAnnotationPosition(paraIndex, startOffset);
    const endPos = this.clampAnnotationPosition(endParaIndex, endOffset);
    if (this.comparePositions(endPos, startPos) <= 0) return null;

    const text = this.buildAnnotationText(startPos, endPos);
    if (!text) return null;
    return {
      paraIndex: startPos.paraIndex,
      startOffset: startPos.charOffset,
      endParaIndex: endPos.paraIndex,
      endOffset: endPos.charOffset,
      length: text.length,
      text,
    };
  }

  private getSelectedSearchText(): string | null {
    const selection = this.captureSelection();
    const text = selection?.text.replace(/\s+/g, ' ').trim();
    return text || null;
  }

  private buildAnnotationText(start: ReaderPosition, end: ReaderPosition): string {
    const parts: string[] = [];
    for (let pi = start.paraIndex; pi <= end.paraIndex && pi < this.paragraphs.length; pi++) {
      const paragraph = this.paragraphs[pi] ?? '';
      const begin = pi === start.paraIndex ? start.charOffset : 0;
      const finish = pi === end.paraIndex ? end.charOffset : paragraph.length;
      parts.push(paragraph.slice(begin, finish));
    }
    return parts.join('\n');
  }

  private clampAnnotationPosition(paraIndex: number, charOffset: number): ReaderPosition {
    const nextParaIndex = Math.max(0, Math.min(paraIndex, Math.max(0, this.paragraphs.length - 1)));
    const paragraphLength = this.paragraphs[nextParaIndex]?.length ?? 0;
    return {
      paraIndex: nextParaIndex,
      charOffset: Math.max(0, Math.min(charOffset, paragraphLength)),
    };
  }

  private findParaElement(node: Node | null): HTMLElement | null {
    let cur: Node | null = node;
    while (cur && cur !== this.contentContainer) {
      if (cur.nodeType === Node.ELEMENT_NODE) {
        const el = cur as HTMLElement;
        if (el.classList.contains('puffs-para')) return el;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  /** 把 (node, offset) 在 paragraph 内换算为纯文本偏移。 */
  private nodeOffsetToTextOffset(para: HTMLElement, node: Node, offset: number): number {
    let total = Number(para.dataset.leadingIndentLength) || 0;
    const walk = (current: Node): boolean => {
      if (current === node) {
        if (current.nodeType === Node.TEXT_NODE) {
          total += offset;
        } else {
          for (let i = 0; i < offset && i < current.childNodes.length; i++) {
            total += (current.childNodes[i].textContent ?? '').length;
          }
        }
        return true;
      }
      if (current.nodeType === Node.TEXT_NODE) {
        total += (current.textContent ?? '').length;
        return false;
      }
      for (const child of Array.from(current.childNodes)) {
        if (walk(child)) return true;
      }
      return false;
    };
    walk(para);
    return total;
  }

  private async addAnnotation(
    sel: AnnotationSelection,
    note: string | undefined,
  ): Promise<void> {
    const next = [...this.getAnnotations()];
    next.push({
      paraIndex: sel.paraIndex,
      startOffset: sel.startOffset,
      length: sel.length,
      endParaIndex: sel.endParaIndex,
      endOffset: sel.endOffset,
      text: sel.text,
      note: note && note.trim() ? note.trim() : undefined,
      createdAt: Date.now(),
    });
    await this.setAnnotations(next);
    window.getSelection()?.removeAllRanges();
    this.renderCurrentPage();
  }

  private openAnnotationModal(sel: AnnotationSelection): void {
    new AnnotationInputModal(this.app, sel.text, (note) => {
      this.addAnnotation(sel, note);
    }).open();
  }

  private handleAnnotationContextMenu(e: MouseEvent): void {
    const target = (e.target as HTMLElement | null)?.closest?.('.puffs-annotation') as HTMLElement | null;
    if (!target) return;
    const idx = Number(target.dataset.annoIdx);
    if (!Number.isFinite(idx)) return;
    const annos = this.getAnnotations();
    const anno = annos[idx];
    if (!anno) return;
    e.preventDefault();
    const menu = new Menu();
    if (anno.note) {
      menu.addItem((item) =>
        item.setTitle(`批注: ${anno.note}`).setIcon('message-square').setDisabled(true),
      );
      menu.addSeparator();
    }
    menu.addItem((item) =>
      item.setTitle('删除').setIcon('trash').onClick(async () => {
        const next = annos.filter((_, i) => i !== idx);
        await this.setAnnotations(next);
        this.renderCurrentPage();
      }),
    );
    menu.showAtMouseEvent(e);
  }

  private async exportAnnotations(): Promise<void> {
    if (!this.currentFile) return;
    const annos = [...this.getAnnotations()].sort(
      (a, b) => a.paraIndex - b.paraIndex || a.startOffset - b.startOffset,
    );
    if (annos.length === 0) {
      new Notice('当前书没有标注');
      return;
    }

    const basename = this.currentFile.basename;
    const blocks = annos.map((a) => {
      const lines: string[] = [];
      if (a.note) lines.push(`批注：${a.note}`);
      lines.push(this.formatAnnotationText(a.text));
      return lines.join('\n');
    });
    const markdown = blocks.join('\n\n') + '\n';

    const dir = (this.plugin.settings.annotationExportDir ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (dir) {
      try {
        await this.app.vault.createFolder(dir);
      } catch {
        // 已存在则忽略
      }
    }
    const targetPath = await this.findAvailableExportPath(dir, `${basename}-笔记`);
    await this.app.vault.adapter.write(targetPath, markdown);
    if (this.plugin.settings.deleteAnnotationsAfterExport) {
      await this.setAnnotations([]);
      this.renderCurrentPage();
      new Notice(`已导出 ${annos.length} 条到 ${targetPath}，并删除对应标注与批注`);
      return;
    }
    new Notice(`已导出 ${annos.length} 条到 ${targetPath}`);
  }

  private renderAnnotationPreview(container: HTMLElement, text: string): void {
    container.empty();
    const paragraphs = this.formatAnnotationText(text)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      container.textContent = '';
      return;
    }

    for (const paragraph of paragraphs) {
      container.createDiv({ cls: 'puffs-note-card-paragraph', text: paragraph });
    }
  }

  private formatAnnotationText(text: string): string {
    return text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\s\u3000]+/, ''))
      .join('\n');
  }

  /** 在目录里寻找一个未占用的 md 文件名；同名时追加 `-2`、`-3` ... */
  private async findAvailableExportPath(dir: string, baseName: string): Promise<string> {
    const prefix = dir ? dir + '/' : '';
    const first = `${prefix}${baseName}.md`;
    if (!(await this.app.vault.adapter.exists(first))) return first;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${prefix}${baseName}-${i}.md`;
      if (!(await this.app.vault.adapter.exists(candidate))) return candidate;
    }
    return `${prefix}${baseName}-${Date.now()}.md`;
  }
}

// ═══════════════════════════ 批注输入弹窗 ═══════════════════════════

interface ChapterChoice {
  chapter: Chapter;
  index: number;
  displayTitle: string;
}

interface ChapterSearchCandidate {
  choice: ChapterChoice;
  textTargets: string[];
  numberTargets: string[];
}

function normalizeChapterSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function parseChapterSearchNumber(raw: string): number {
  const text = raw.trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);

  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const smallUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  const largeUnits: Record<string, number> = { 万: 10000, 亿: 100000000 };

  const allDigits = [...text].every((ch) => ch in digits);
  if (allDigits && text.length >= 2) {
    let result = 0;
    for (const ch of text) result = result * 10 + digits[ch];
    return result;
  }

  let total = 0;
  let section = 0;
  let number = 0;
  for (const ch of text) {
    if (ch in digits) {
      number = digits[ch];
    } else if (ch in smallUnits) {
      section += (number || 1) * smallUnits[ch];
      number = 0;
    } else if (ch in largeUnits) {
      section += number;
      total += (section || 1) * largeUnits[ch];
      section = 0;
      number = 0;
    } else {
      return 0;
    }
  }

  return total + section + number;
}

function normalizeChapterSearchNumber(raw: string): string | null {
  const normalized = raw.trim();
  if (!normalized) return null;
  const parsed = parseChapterSearchNumber(normalized);
  if (parsed > 0 || /^0+$/.test(normalized)) return String(parsed);
  return null;
}

function getChapterSearchNumberTokens(text: string): string[] {
  const result = new Set<string>();
  for (const match of text.matchAll(/[零〇一二两三四五六七八九十百千万亿\d]+/g)) {
    const token = match[0];
    if (/^\d+$/.test(token)) {
      result.add(String(Number(token)));
      result.add(token);
      continue;
    }
    const normalized = normalizeChapterSearchNumber(token);
    if (normalized) result.add(normalized);
  }
  return [...result];
}

function buildChapterSearchCandidate(choice: ChapterChoice): ChapterSearchCandidate {
  const title = normalizeChapterSearchText(choice.displayTitle);
  const rawTitle = normalizeChapterSearchText(choice.chapter.rawTitle);
  return {
    choice,
    textTargets: [title, rawTitle],
    numberTargets: getChapterSearchNumberTokens(`${choice.displayTitle} ${choice.chapter.rawTitle}`),
  };
}

function getChapterSearchRank(candidate: ChapterSearchCandidate, query: string, numericQuery: string | null): number {
  if (numericQuery) {
    if (candidate.numberTargets.some((target) => target === numericQuery)) return 0;
    if (candidate.numberTargets.some((target) => target.startsWith(numericQuery))) return 1;
    if (candidate.numberTargets.some((target) => target.includes(numericQuery))) return 2;
  }
  if (candidate.textTargets.some((target) => target.includes(query))) return numericQuery ? 3 : 0;
  return Number.POSITIVE_INFINITY;
}

function getChapterSuggestions(
  candidates: ChapterSearchCandidate[],
  preferredIndex: number,
  query: string,
): ChapterChoice[] {
  const normalized = query.trim();
  if (!normalized) {
    return [...candidates]
      .sort((a, b) => {
        if (a.choice.index === preferredIndex) return -1;
        if (b.choice.index === preferredIndex) return 1;
        return a.choice.index - b.choice.index;
      })
      .slice(0, 100)
      .map((candidate) => candidate.choice);
  }

  const textQuery = normalizeChapterSearchText(normalized);
  const numericQuery = normalizeChapterSearchNumber(normalized);
  return candidates
    .map((candidate) => ({
      candidate,
      rank: getChapterSearchRank(candidate, textQuery, numericQuery),
    }))
    .filter((item) => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || a.candidate.choice.index - b.candidate.choice.index)
    .slice(0, 100)
    .map((item) => item.candidate.choice);
}

class ChapterInputSuggest extends AbstractInputSuggest<ChapterChoice> {
  private candidates: ChapterSearchCandidate[];
  private preferredIndex: number;

  constructor(app: App, inputEl: HTMLInputElement, choices: ChapterChoice[], preferredIndex: number) {
    super(app, inputEl);
    this.candidates = choices.map((choice) => buildChapterSearchCandidate(choice));
    this.preferredIndex = preferredIndex;
    this.limit = 100;
  }

  setPreferredIndex(index: number): void {
    this.preferredIndex = index;
  }

  protected getSuggestions(query: string): ChapterChoice[] {
    return getChapterSuggestions(this.candidates, this.preferredIndex, query);
  }

  renderSuggestion(choice: ChapterChoice, el: HTMLElement): void {
    el.createDiv({ cls: 'puffs-chapter-copy-suggestion', text: choice.displayTitle });
  }
}

class ChapterRangeCopyModal extends Modal {
  private choices: ChapterChoice[];
  private onPreview: (startIndex: number, endIndex: number) => number | null;
  private onBatchPreview: (startIndex: number, endIndex: number, chunkSize: number) => number | null;
  private onSplit: (startIndex: number, endIndex: number, chunkSize: number | null) => Promise<boolean>;
  private onDismiss: () => void;
  private suggests: ChapterInputSuggest[] = [];
  private activeSuggest: ChapterInputSuggest | null = null;
  private batchStart: ChapterChoice;
  private batchEnd: ChapterChoice;
  private estimateInput!: HTMLInputElement;
  private chunkInput!: HTMLInputElement;

  constructor(
    app: App,
    choices: ChapterChoice[],
    initialChapterIndex: number,
    onPreview: (startIndex: number, endIndex: number) => number | null,
    onBatchPreview: (startIndex: number, endIndex: number, chunkSize: number) => number | null,
    onSplit: (startIndex: number, endIndex: number, chunkSize: number | null) => Promise<boolean>,
    onDismiss: () => void,
  ) {
    super(app);
    this.choices = choices;
    this.onPreview = onPreview;
    this.onBatchPreview = onBatchPreview;
    this.onSplit = onSplit;
    this.onDismiss = onDismiss;
    this.batchStart = choices.find((choice) => choice.index === initialChapterIndex) ?? choices[0];
    this.batchEnd = choices[choices.length - 1];
  }

  onOpen(): void {
    this.modalEl.addClass('puffs-chapter-copy-modal');
    this.renderSplitForm();
  }

  private renderHeader(title: string): void {
    const header = this.contentEl.createDiv({ cls: 'puffs-chapter-copy-head' });
    header.createEl('h3', { cls: 'puffs-chapter-copy-title', text: title });
  }

  private renderSplitForm(): void {
    this.contentEl.empty();
    this.renderHeader('拆分文本');

    const startInput = this.createLabeledInput('起始章节', this.getChoiceDisplayText(this.batchStart));
    const endInput = this.createLabeledInput('结束章节', this.getChoiceDisplayText(this.batchEnd));
    this.chunkInput = this.createLabeledInput('每份几章', '', 'number');
    this.chunkInput.min = '1';
    this.chunkInput.step = '1';
    this.estimateInput = this.createLabeledInput('预计字数', '', 'text');
    this.estimateInput.readOnly = true;

    const refreshEstimate = () => {
      const chunkSize = this.parseChunkSize(false);
      const count = chunkSize === undefined ? null : chunkSize === null
        ? this.onPreview(this.batchStart.index, this.batchEnd.index)
        : this.onBatchPreview(this.batchStart.index, this.batchEnd.index, chunkSize);
      this.estimateInput.value = count === null ? '' : String(count);
    };

    this.createSuggest(startInput, () => this.batchStart, (choice) => {
      if (choice.index > this.batchEnd.index) {
        new Notice('起始章节不能晚于结束章节');
        return false;
      }
      this.batchStart = choice;
      startInput.value = this.getChoiceDisplayText(choice);
      refreshEstimate();
      return true;
    });
    this.createSuggest(endInput, () => this.batchEnd, (choice) => {
      if (choice.index < this.batchStart.index) {
        new Notice('结束章节不能早于起始章节');
        return false;
      }
      this.batchEnd = choice;
      endInput.value = this.getChoiceDisplayText(choice);
      refreshEstimate();
      return true;
    });

    this.chunkInput.addEventListener('input', refreshEstimate);
    for (const input of [startInput, endInput, this.chunkInput]) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if ((input === startInput || input === endInput) && this.activeSuggest) return;
        e.preventDefault();
        void this.confirmSplit(this.chunkInput);
      });
    }
    refreshEstimate();
    window.setTimeout(() => this.chunkInput.focus(), 0);
  }

  private createLabeledInput(label: string, value: string, type = 'text'): HTMLInputElement {
    const row = this.contentEl.createDiv({ cls: 'puffs-chapter-copy-row' });
    row.createSpan({ cls: 'puffs-chapter-copy-label', text: label });
    const input = row.createEl('input', {
      cls: 'puffs-chapter-copy-input',
      attr: { type, autocomplete: 'off' },
    }) as HTMLInputElement;
    input.value = value;
    return input;
  }

  private createSuggest(
    input: HTMLInputElement,
    getCurrentChoice: () => ChapterChoice,
    onSelect: (choice: ChapterChoice) => boolean,
  ): void {
    const suggest = new ChapterInputSuggest(this.app, input, this.choices, getCurrentChoice().index);
    suggest.onSelect((choice) => {
      if (!onSelect(choice)) return;
      input.value = this.getChoiceDisplayText(choice);
      suggest.close();
      if (this.activeSuggest === suggest) this.activeSuggest = null;
    });
    input.addEventListener('click', () => {
      suggest.setPreferredIndex(getCurrentChoice().index);
      suggest.setValue(input.value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      this.activeSuggest = suggest;
      suggest.open();
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!input.value) input.value = this.getChoiceDisplayText(getCurrentChoice());
        suggest.close();
        if (this.activeSuggest === suggest) this.activeSuggest = null;
      }, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeSuggest === suggest) {
        e.preventDefault();
        e.stopImmediatePropagation();
        input.value = this.getChoiceDisplayText(getCurrentChoice());
        suggest.close();
        this.activeSuggest = null;
      }
    });
    this.suggests.push(suggest);
  }

  private async confirmSplit(input: HTMLInputElement): Promise<void> {
    const chunkSize = this.parseChunkSize(true);
    if (chunkSize === undefined) {
      input.focus();
      return;
    }
    const copied = await this.onSplit(this.batchStart.index, this.batchEnd.index, chunkSize);
    if (copied) this.close();
    else input.focus();
  }

  private parseChunkSize(showNotice: boolean): number | null | undefined {
    const raw = this.chunkInput.value.trim();
    if (!raw) return null;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) return value;
    if (showNotice) new Notice('每份几章必须是正整数，或留空表示拆成一份文本');
    return undefined;
  }

  private getChoiceDisplayText(choice: ChapterChoice): string {
    return choice.displayTitle;
  }

  onClose(): void {
    for (const suggest of this.suggests) suggest.close();
    this.suggests = [];
    this.activeSuggest = null;
    this.contentEl.empty();
    this.onDismiss();
  }
}

class AnnotationInputModal extends Modal {
  private defaultText: string;
  private onSubmit: (note: string) => void;

  constructor(app: App, defaultText: string, onSubmit: (note: string) => void) {
    super(app);
    this.defaultText = defaultText;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass('puffs-anno-modal');

    contentEl.createEl('h3', { cls: 'puffs-anno-modal-title', text: '添加批注' });

    const preview = contentEl.createDiv({ cls: 'puffs-anno-modal-preview' });
    preview.textContent = this.defaultText;
    const input = contentEl.createEl('input', {
      cls: 'puffs-anno-modal-input',
      attr: { type: 'text', placeholder: '输入批注内容，回车保存' },
    }) as HTMLInputElement;
    setTimeout(() => input.focus(), 0);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value;
        this.close();
        this.onSubmit(value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if ((e.key === ' ' || e.code === 'Space') && input.value.length === 0) {
        // 长按空格唤出弹窗时，避免 keyup 在输入框里塞入空格作为首字符。
        e.preventDefault();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
