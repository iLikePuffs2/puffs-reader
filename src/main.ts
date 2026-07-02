import { Plugin, TFile, FuzzySuggestModal, WorkspaceLeaf, normalizePath, ItemView, ViewStateResult, setIcon, Menu, Notice } from 'obsidian';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { dirname, isAbsolute, join, resolve } from 'path';

const execAsync = promisify(exec);
import { ReaderView, READER_VIEW_TYPE } from './ReaderView';
import { SettingsTab } from './SettingsTab';
import {
  ReaderSettings,
  BookProgress,
  BookSettings,
  BookTags,
  BookDailyReadingStats,
  CountedRange,
  DEFAULT_TAG_CATALOG,
  DEFAULT_SETTINGS,
  ReadChapterRange,
  ReadingStatsData,
  TagCatalog,
} from './types';

const READING_STATS_VIEW_TYPE = 'puffs-reading-stats-view';
const LEGACY_DEFAULT_TOC_REGEX = '^\\s*第[零〇一二三四五六七八九十百千万亿两\\d]+[章节回卷集部篇].*$';
const LEGACY_DEFAULT_CHAPTER_TITLE_REGEX = '^\\s*第([零〇一二三四五六七八九十百千万亿两\\d]+)([章节回卷集部篇])\\s*(.*)$';
const LEGACY_PROLOGUE_TOC_REGEX = '^\\s*(?:第[零〇一二三四五六七八九十百千万亿两\\d]+[章节回卷集部篇].*|(?:序章|楔子|引子)(?:\\s+.*)?)$';
const LEGACY_PROLOGUE_CHAPTER_TITLE_REGEX = '^\\s*(?:第([零〇一二三四五六七八九十百千万亿两\\d]+)([章节回卷集部篇])\\s*(.*)|((?:序章|楔子|引子)(?:\\s+.*)?))$';
const SUMMARY_BOOK_SUFFIX = '-概括版';
const UNRECOGNIZED_CHAPTER_TITLE = '未识别章节';

type TagCatalogGroup = keyof TagCatalog;
type ReadingStatsTagFilterGroup = TagCatalogGroup | 'accumulation';

interface ReadingStatsTagFilters {
  genre: Set<string>;
  status: Set<string>;
  feature: Set<string>;
  accumulation: Set<string>;
}

function createEmptyBookTags(): BookTags {
  return { genre: [], feature: [], accumulation: [] };
}

function normalizeTagName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAccumulationTagName(value: unknown): string {
  return normalizeTagName(value).replace(/^已积累/, '').trim();
}

function uniqueNormalizedTags(values: unknown[], normalize: (value: unknown) => string = normalizeTagName): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = normalize(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

function normalizePositiveChapter(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function normalizeBookTags(input: BookTags | undefined): BookTags {
  const raw = (input ?? {}) as Partial<BookTags>;
  const status = normalizeTagName(raw.status);
  const accumulation = Array.isArray(raw.accumulation)
    ? raw.accumulation
      .map((item) => {
        const record = item as Partial<BookTags['accumulation'][number]> | null | undefined;
        const name = normalizeAccumulationTagName(record?.name);
        if (!name) return null;
        const startChapter = normalizePositiveChapter(record?.startChapter);
        const normalizedEnd = normalizePositiveChapter(record?.endChapter);
        const endChapter = startChapter !== undefined && normalizedEnd !== undefined && normalizedEnd < startChapter
          ? undefined
          : normalizedEnd;
        return {
          name,
          ...(startChapter !== undefined ? { startChapter } : {}),
          ...(endChapter !== undefined ? { endChapter } : {}),
        };
      })
      .filter((item): item is BookTags['accumulation'][number] => item !== null)
    : [];
  const byName = new Map<string, BookTags['accumulation'][number]>();
  for (const item of accumulation) {
    if (!byName.has(item.name)) byName.set(item.name, item);
  }
  return {
    genre: uniqueNormalizedTags(Array.isArray(raw.genre) ? raw.genre : []),
    ...(status ? { status } : {}),
    feature: uniqueNormalizedTags(Array.isArray(raw.feature) ? raw.feature : []),
    accumulation: Array.from(byName.values()),
  };
}

function hasAnyBookTags(tags: BookTags | undefined): boolean {
  const normalized = normalizeBookTags(tags);
  return normalized.genre.length > 0
    || !!normalized.status
    || normalized.feature.length > 0
    || normalized.accumulation.length > 0;
}

function normalizeTagCatalog(input: TagCatalog | undefined): TagCatalog {
  return {
    genre: uniqueNormalizedTags([...(DEFAULT_TAG_CATALOG.genre ?? []), ...((input?.genre ?? []) as unknown[])]),
    status: uniqueNormalizedTags([...(DEFAULT_TAG_CATALOG.status ?? []), ...((input?.status ?? []) as unknown[])]),
    feature: uniqueNormalizedTags([...(DEFAULT_TAG_CATALOG.feature ?? []), ...((input?.feature ?? []) as unknown[])]),
  };
}

function formatAccumulationTagLabel(tag: BookTags['accumulation'][number]): string {
  if (tag.startChapter !== undefined && tag.endChapter !== undefined) {
    return `${tag.name} ${tag.startChapter}-${tag.endChapter}章`;
  }
  if (tag.startChapter !== undefined) return `${tag.name} 第${tag.startChapter}章起`;
  if (tag.endChapter !== undefined) return `${tag.name} 至第${tag.endChapter}章`;
  return tag.name;
}

function getReadingStatsDisplayTitle(filePath: string, title?: string): string {
  const trimmedTitle = (title ?? '').trim();
  if (trimmedTitle) return trimmedTitle;
  const baseName = filePath.split(/[\\/]/).pop() ?? filePath;
  return baseName.replace(/\.[^.]+$/, '') || filePath;
}

function stripSummaryBookSuffix(title: string): string {
  return title.endsWith(SUMMARY_BOOK_SUFFIX) ? title.slice(0, -SUMMARY_BOOK_SUFFIX.length) : title;
}

function getReadingStatsGroupKey(filePath: string, title?: string): string {
  return stripSummaryBookSuffix(getReadingStatsDisplayTitle(filePath, title));
}

function isSummaryReadingStatsBook(filePath: string, title?: string): boolean {
  const displayTitle = (title ?? '').trim();
  const baseName = (filePath.split(/[\\/]/).pop() ?? filePath).replace(/\.[^.]+$/, '');
  return displayTitle.endsWith(SUMMARY_BOOK_SUFFIX) || baseName.endsWith(SUMMARY_BOOK_SUFFIX);
}

/** 插件持久化数据结构 */
interface PluginData {
  settings: ReaderSettings;
  progress: Record<string, BookProgress>;
  bookSettings?: Record<string, BookSettings>;
  tagCatalog?: TagCatalog;
  readingStats?: ReadingStatsData;
  lastDataBackupAt?: number;
  knownBooks?: string[];
}

interface ReadingStatRecord {
  filePath: string;
  title: string;
  readingMs?: number;
  readWords?: number;
  countedRange?: CountedRange;
  chapterRanges?: ReadChapterRange[];
  timestamp?: number;
}

type ReadingStatsMetric = 'words' | 'time' | 'speed';
type ReadingStatsSpeedUnit = 'hour' | 'minute';

interface ReadingStatsChartPoint {
  label: string;
  value: number;
  title: string;
}

interface AggregatedDailyReadingStats {
  readingMs: number;
  readWords: number;
  readChapterRanges: ReadChapterRange[];
}

interface AggregatedBookStats {
  groupKey: string;
  title: string;
  filePaths: string[];
  originalFilePath?: string;
  hasOriginalSource: boolean;
  hasOriginalTags: boolean;
  tags: BookTags;
  totalReadingMs: number;
  totalReadWords: number;
  readChapterRanges: ReadChapterRange[];
  daily: Record<string, AggregatedDailyReadingStats>;
  lastReadAt: number;
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

class ReadingStatsView extends ItemView {
  private plugin: PuffsReaderPlugin;
  private selectedBookPath: string | null = null;
  private renderVersion = 0;
  private globalMetric: ReadingStatsMetric | null = null;
  private bookMetric: ReadingStatsMetric | null = null;
  private speedUnit: ReadingStatsSpeedUnit = 'hour';
  private tagFilters: ReadingStatsTagFilters = {
    genre: new Set<string>(),
    status: new Set<string>(),
    feature: new Set<string>(),
    accumulation: new Set<string>(),
  };

  constructor(leaf: WorkspaceLeaf, plugin: PuffsReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return READING_STATS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '书架';
  }

  getIcon(): string {
    return 'bar-chart-3';
  }

  async onOpen(): Promise<void> {
    const handleBackHotkey = (event: KeyboardEvent) => this.handleBookDetailBackHotkey(event);
    window.addEventListener('keydown', handleBackHotkey, true);
    document.addEventListener('keydown', handleBackHotkey, true);
    this.register(() => {
      window.removeEventListener('keydown', handleBackHotkey, true);
      document.removeEventListener('keydown', handleBackHotkey, true);
    });
    this.render();
  }

  showGlobalDefault(): void {
    this.selectedBookPath = null;
    this.globalMetric = null;
    this.bookMetric = null;
    this.render();
  }

  getState(): Record<string, unknown> {
    return { book: this.selectedBookPath };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const viewState = state as Record<string, unknown> | null;
    this.selectedBookPath = typeof viewState?.book === 'string' ? viewState.book : null;
    this.render();
    await super.setState(state, result);
  }

  private render(): void {
    this.renderVersion++;
    this.contentEl.empty();
    this.contentEl.addClass('puffs-reading-stats-view');
    const page = this.contentEl.createDiv({ cls: 'puffs-reading-stats-page' });
    if (this.selectedBookPath) {
      this.renderBookDetail(page, this.selectedBookPath);
    } else {
      this.renderGlobal(page);
    }
  }

  private renderGlobal(parent: HTMLElement): void {
    const allBooks = this.getAggregatedBooks().sort((a, b) => b.lastReadAt - a.lastReadAt);
    const books = allBooks.filter((book) => this.matchesTagFilters(book));
    const dailyEntries = this.getDailyEntriesForBooks(books).sort((a, b) => a[0].localeCompare(b[0]));
    const totalReadingMs = dailyEntries.reduce((sum, [, item]) => sum + item.readingMs, 0);
    const totalReadWords = dailyEntries.reduce((sum, [, item]) => sum + item.readWords, 0);
    const readingDays = dailyEntries.filter(([, item]) => item.readingMs > 0 || item.readWords > 0).length;

    this.renderHeader(parent, '阅读统计', false, (actions) => this.renderRefreshButton(actions));
    const summary = parent.createDiv({ cls: 'puffs-reading-stats-summary' });
    summary.addClass('is-global');
    this.createSummaryItem(summary, '阅读天数', `${readingDays} 天`);
    this.createSummaryItem(summary, '累计字数', this.formatCompactNumber(totalReadWords), 'words', this.globalMetric === 'words', () => this.toggleGlobalMetric('words'));
    this.createSummaryItem(summary, '累计时长', this.formatCompactDuration(totalReadingMs), 'time', this.globalMetric === 'time', () => this.toggleGlobalMetric('time'));
    this.createSummaryItem(summary, '平均阅读速度', this.formatSpeed(totalReadWords, totalReadingMs, 'hour'), 'speed', this.globalMetric === 'speed', () => this.toggleGlobalMetric('speed'));
    this.createSummaryItem(summary, '统计书籍', `${books.length} 本`);

    this.renderTagFilters(parent, allBooks);

    if (this.globalMetric) {
      this.renderMetricChart(parent, this.globalMetric, dailyEntries.map(([date, item]) => ({
        date,
        readWords: item.readWords,
        readingMs: item.readingMs,
      })));
    }

    this.createSectionTitle(parent, '最近阅读');
    const list = parent.createDiv({ cls: 'puffs-reading-stats-list' });
    if (books.length === 0) {
      list.createDiv({
        cls: 'puffs-reading-stats-empty',
        text: allBooks.length > 0 && this.hasActiveTagFilters()
          ? '没有匹配当前标签筛选的阅读统计。'
          : '暂无阅读统计。打开一本书并停留阅读后开始记录。',
      });
      return;
    }

    for (const book of books) {
      const card = list.createDiv({ cls: 'puffs-reading-stats-book' });
      const openBook = () => {
        this.selectedBookPath = book.groupKey;
        this.render();
      };
      card.setAttr('tabindex', '0');
      card.addEventListener('click', openBook);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openBook();
        }
      });
      this.registerBookStatsContextMenu(card, book.groupKey);
      const main = card.createDiv({ cls: 'puffs-reading-stats-book-main' });
      main.createDiv({ cls: 'puffs-reading-stats-book-title', text: book.title });
      this.renderBookTagBadges(main, book.tags, ['genre', 'status', 'feature']);
      const meta = main.createDiv({ cls: 'puffs-reading-stats-book-meta' });
      meta.createSpan({
        text: [
          `时长 ${this.formatCompactDuration(book.totalReadingMs)}`,
          `字数 ${this.formatCompactNumber(book.totalReadWords)}`,
          `平均阅读速度 ${this.formatSpeed(book.totalReadWords, book.totalReadingMs, 'hour')}`,
          `最近 ${this.formatDateTime(book.lastReadAt)}`,
        ].join('；'),
      });
      const arrow = card.createSpan({ cls: 'puffs-reading-stats-book-arrow' });
      setIcon(arrow, 'chevron-right');
    }
  }

  private renderBookDetail(parent: HTMLElement, groupKey: string): void {
    const books = this.getAggregatedBooks();
    const book = books.find((item) => item.groupKey === groupKey) ?? books.find((item) => item.filePaths.includes(groupKey));
    if (!book) {
      this.selectedBookPath = null;
      this.renderGlobal(parent);
      return;
    }
    this.selectedBookPath = book.groupKey;

    this.renderHeader(parent, book.title, true, (actions) => {
      this.renderOpenBookButton(actions, book);
      this.renderRefreshButton(actions);
    });
    const dailyEntries = Object.entries(book.daily ?? {}).sort((a, b) => b[0].localeCompare(a[0]));
    const readingDays = dailyEntries.filter(([, item]) => item.readingMs > 0 || item.readWords > 0).length;

    const summary = parent.createDiv({ cls: 'puffs-reading-stats-summary' });
    summary.addClass('is-detail');
    this.createSummaryItem(summary, '阅读天数', `${readingDays} 天`);
    this.createSummaryItem(summary, '累计字数', this.formatCompactNumber(book.totalReadWords), 'words', this.bookMetric === 'words', () => this.toggleBookMetric('words'));
    this.createSummaryItem(summary, '累计时长', this.formatCompactDuration(book.totalReadingMs), 'time', this.bookMetric === 'time', () => this.toggleBookMetric('time'));
    this.createSummaryItem(summary, '平均阅读速度', this.formatSpeed(book.totalReadWords, book.totalReadingMs, 'hour'), 'speed', this.bookMetric === 'speed', () => this.toggleBookMetric('speed'));

    this.createSectionTitle(parent, '相关标签');
    this.renderReadonlyTagRows(parent, book.tags);

    if (this.bookMetric) {
      this.renderMetricChart(parent, this.bookMetric, [...dailyEntries].reverse().map(([date, item]) => ({
        date,
        readWords: item.readWords,
        readingMs: item.readingMs,
      })));
    }

    this.createSectionTitle(parent, '每日明细');
    const list = parent.createDiv({ cls: 'puffs-reading-stats-list' });
    const visibleDailyEntries = dailyEntries.filter(([, item]) => Math.round(item.readingMs / 60000) > 0 && item.readWords > 0);
    if (visibleDailyEntries.length === 0) {
      list.createDiv({ cls: 'puffs-reading-stats-empty', text: '这本书暂无每日明细。' });
      return;
    }
    for (const [date, item] of visibleDailyEntries) {
      const card = list.createDiv({ cls: 'puffs-reading-stats-day' });
      this.registerBookDailyStatsContextMenu(card, book.groupKey, date);
      card.createDiv({ cls: 'puffs-reading-stats-day-title', text: date });
      const meta = card.createDiv({ cls: 'puffs-reading-stats-book-meta' });
      meta.createSpan({
        text: [
          `时长 ${this.formatCompactDuration(item.readingMs)}`,
          `字数 ${this.formatCompactNumber(item.readWords)}`,
          `平均阅读速度 ${this.formatSpeed(item.readWords, item.readingMs, 'hour')}`,
        ].join('；'),
      });
      const chapterText = this.formatChapterRanges(item.readChapterRanges, '阅读章节');
      if (chapterText) {
        card.createDiv({ cls: 'puffs-reading-stats-chapters puffs-reading-stats-day-chapters', text: chapterText });
      }
    }
  }

  private renderHeader(
    parent: HTMLElement,
    title: string,
    withBack = false,
    renderActions?: (parent: HTMLElement) => void,
  ): void {
    const header = parent.createDiv({ cls: 'puffs-reading-stats-header' });
    if (withBack) {
      const back = header.createEl('button', { cls: 'puffs-icon-btn puffs-reading-stats-back', attr: { 'aria-label': '返回阅读统计' } });
      setIcon(back, 'arrow-left');
      back.addEventListener('click', () => {
        this.goBackToGlobal();
      });
    }
    header.createEl('h3', { cls: 'puffs-reading-stats-title', text: title });
    const actions = header.createDiv({ cls: 'puffs-reading-stats-header-actions' });
    if (renderActions) renderActions(actions);
  }

  private renderRefreshButton(parent: HTMLElement): void {
    const button = parent.createEl('button', {
      cls: 'puffs-icon-btn puffs-reading-stats-action',
      attr: { 'aria-label': '刷新阅读统计' },
    });
    setIcon(button, 'refresh-cw');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.render();
    });
  }

  private renderOpenBookButton(parent: HTMLElement, book: AggregatedBookStats): void {
    const button = parent.createEl('button', {
      cls: 'puffs-icon-btn puffs-reading-stats-action',
      attr: { 'aria-label': '打开原书' },
    });
    setIcon(button, 'book-open');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openOriginalBook(book).catch((error) => console.error('[Puffs Reader] Failed to open original book:', error));
    });
  }

  private async openOriginalBook(book: AggregatedBookStats): Promise<void> {
    if (!book.originalFilePath) {
      new Notice('未找到这本书的原版文件');
      return;
    }
    const file = this.plugin.app.vault.getAbstractFileByPath(book.originalFilePath);
    if (!(file instanceof TFile)) {
      new Notice('原版文件不存在，无法打开');
      return;
    }
    await this.plugin.openInReader(file);
  }

  private handleBookDetailBackHotkey(event: KeyboardEvent): void {
    if (!this.selectedBookPath) return;
    if (!event.altKey || event.key !== 'ArrowLeft' || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!this.contentEl.closest('.workspace-leaf.mod-active') && !this.contentEl.contains(document.activeElement)) return;
    event.preventDefault();
    event.stopPropagation();
    this.goBackToGlobal();
  }

  private goBackToGlobal(): void {
    this.selectedBookPath = null;
    this.globalMetric = null;
    this.render();
  }

  private createSummaryItem(
    parent: HTMLElement,
    label: string,
    value: string,
    metric?: ReadingStatsMetric,
    active = false,
    onClick?: () => void,
  ): void {
    const item = parent.createDiv({ cls: 'puffs-reading-stats-summary-item' });
    if (metric) {
      item.addClass('is-clickable');
      item.setAttr('tabindex', '0');
      item.setAttr('role', 'button');
      item.setAttr('aria-pressed', active ? 'true' : 'false');
    }
    if (active) item.addClass('is-active');
    item.createDiv({ cls: 'puffs-reading-stats-summary-label', text: label });
    item.createDiv({ cls: 'puffs-reading-stats-summary-value', text: value });
    if (onClick) {
      item.addEventListener('click', onClick);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      });
    }
  }

  private createSectionTitle(parent: HTMLElement, title: string): void {
    parent.createDiv({ cls: 'puffs-reading-stats-section-title', text: title });
  }

  private renderTagFilters(parent: HTMLElement, books: AggregatedBookStats[]): void {
    const options = this.getTagFilterOptions(books);
    const hasOptions = options.genre.length > 0
      || options.status.length > 0
      || options.feature.length > 0
      || options.accumulation.length > 0;
    if (!hasOptions && !this.hasActiveTagFilters()) return;

    const titleRow = parent.createDiv({ cls: 'puffs-reading-stats-filter-title-row' });
    titleRow.createDiv({ cls: 'puffs-reading-stats-title puffs-reading-stats-filter-title', text: '标签筛选' });
    const clearBtn = titleRow.createEl('button', {
      cls: 'puffs-reading-stats-tag-clear',
      text: '清除',
      attr: { 'aria-label': '清除标签筛选' },
    });
    const hasFilters = this.hasActiveTagFilters();
    clearBtn.classList.toggle('is-hidden', !hasFilters);
    clearBtn.disabled = !hasFilters;
    clearBtn.addEventListener('click', () => {
      this.clearTagFilters();
      this.render();
    });

    const panel = parent.createDiv({ cls: 'puffs-reading-stats-tag-filter' });
    this.renderTagFilterGroup(panel, '题材', 'genre', options.genre);
    this.renderTagFilterGroup(panel, '状态', 'status', options.status);
    this.renderTagFilterGroup(panel, '特色', 'feature', options.feature);
    this.renderTagFilterGroup(panel, '已积累', 'accumulation', options.accumulation);
  }

  private renderTagFilterGroup(
    parent: HTMLElement,
    label: string,
    group: ReadingStatsTagFilterGroup,
    options: string[],
  ): void {
    if (options.length === 0) return;
    const row = parent.createDiv({ cls: 'puffs-reading-stats-tag-filter-row' });
    row.createSpan({ cls: 'puffs-reading-stats-tag-filter-label', text: label });
    const chips = row.createDiv({ cls: 'puffs-reading-stats-tag-filter-chips' });
    for (const option of options) {
      const active = this.tagFilters[group].has(option);
      const chip = chips.createEl('button', {
        cls: active ? 'puffs-tag-chip is-active' : 'puffs-tag-chip',
        text: option,
      });
      chip.addEventListener('click', () => {
        this.toggleTagFilter(group, option);
        this.render();
      });
    }
  }

  private getTagFilterOptions(books: AggregatedBookStats[]): Record<ReadingStatsTagFilterGroup, string[]> {
    const catalog = this.plugin.getTagCatalog();
    return {
      genre: uniqueNormalizedTags([...catalog.genre, ...books.flatMap((book) => book.tags.genre)]),
      status: uniqueNormalizedTags([...catalog.status, ...books.map((book) => book.tags.status ?? '')]),
      feature: uniqueNormalizedTags([...catalog.feature, ...books.flatMap((book) => book.tags.feature)]),
      accumulation: uniqueNormalizedTags([
        ...catalog.feature,
        ...books.flatMap((book) => book.tags.accumulation.map((tag) => tag.name)),
      ]),
    };
  }

  private toggleTagFilter(group: ReadingStatsTagFilterGroup, value: string): void {
    const filters = this.tagFilters[group];
    if (filters.has(value)) filters.delete(value);
    else filters.add(value);
    this.globalMetric = null;
  }

  private clearTagFilters(): void {
    for (const filters of Object.values(this.tagFilters)) filters.clear();
    this.globalMetric = null;
  }

  private hasActiveTagFilters(): boolean {
    return Object.values(this.tagFilters).some((filters) => filters.size > 0);
  }

  private matchesTagFilters(book: AggregatedBookStats): boolean {
    const tags = normalizeBookTags(book.tags);
    return this.matchesTagFilterGroup(this.tagFilters.genre, tags.genre)
      && this.matchesTagFilterGroup(this.tagFilters.status, tags.status ? [tags.status] : [])
      && this.matchesTagFilterGroup(this.tagFilters.feature, tags.feature)
      && this.matchesTagFilterGroup(this.tagFilters.accumulation, tags.accumulation.map((tag) => tag.name));
  }

  private matchesTagFilterGroup(filters: Set<string>, values: string[]): boolean {
    return filters.size === 0 || values.some((value) => filters.has(value));
  }

  private getDailyEntriesForBooks(books: AggregatedBookStats[]): Array<[string, AggregatedDailyReadingStats]> {
    const dailyByDate: Record<string, AggregatedDailyReadingStats> = {};
    for (const book of books) {
      for (const [date, daily] of Object.entries(book.daily ?? {})) {
        const aggregate = dailyByDate[date] ?? { readingMs: 0, readWords: 0, readChapterRanges: [] };
        aggregate.readingMs += daily.readingMs;
        aggregate.readWords += daily.readWords;
        aggregate.readChapterRanges = this.mergeDisplayableChapterRanges([
          ...aggregate.readChapterRanges,
          ...(daily.readChapterRanges ?? []),
        ]);
        dailyByDate[date] = aggregate;
      }
    }
    return Object.entries(dailyByDate);
  }

  private renderBookTagBadges(
    parent: HTMLElement,
    tags: BookTags,
    groups: ReadingStatsTagFilterGroup[] = ['genre', 'status', 'feature', 'accumulation'],
    extraClass = '',
  ): void {
    const tagGroups = this.getBookTagGroups(tags).filter((group) => groups.includes(group.group) && group.labels.length > 0);
    if (tagGroups.length === 0) return;
    const row = parent.createDiv({
      cls: ['puffs-reading-stats-tags', extraClass].filter(Boolean).join(' '),
    });
    for (const group of tagGroups) {
      const groupEl = row.createSpan({ cls: `puffs-reading-stats-tag-group is-${group.group}` });
      for (const label of group.labels) {
        groupEl.createSpan({ cls: `puffs-reading-stats-tag is-${group.group}`, text: label });
      }
    }
  }

  private renderReadonlyTagRows(parent: HTMLElement, tags: BookTags): void {
    const panel = parent.createDiv({ cls: 'puffs-reading-stats-tag-filter puffs-reading-stats-tag-readonly' });
    for (const group of this.getBookTagGroups(tags)) {
      const row = panel.createDiv({ cls: 'puffs-reading-stats-tag-filter-row' });
      row.createSpan({ cls: 'puffs-reading-stats-tag-filter-label', text: group.label });
      const chips = row.createDiv({ cls: 'puffs-reading-stats-tag-filter-chips' });
      const labels = group.labels.length > 0 ? group.labels : ['无'];
      for (const label of labels) {
        chips.createEl('button', {
          cls: label === '无' ? 'puffs-tag-chip is-readonly is-empty' : `puffs-tag-chip is-readonly is-${group.group}`,
          text: label,
          attr: {
            type: 'button',
            tabindex: '-1',
          },
        });
      }
    }
  }

  private getBookTagGroups(tags: BookTags): Array<{ group: ReadingStatsTagFilterGroup; label: string; labels: string[] }> {
    const normalized = normalizeBookTags(tags);
    return [
      { group: 'genre' as const, label: '题材', labels: normalized.genre },
      { group: 'status' as const, label: '状态', labels: normalized.status ? [normalized.status] : [] },
      { group: 'feature' as const, label: '特色', labels: normalized.feature },
      {
        group: 'accumulation' as const,
        label: '已积累',
        labels: normalized.accumulation.map((tag) => formatAccumulationTagLabel(tag)),
      },
    ];
  }

  private getAggregatedBooks(): AggregatedBookStats[] {
    const stats = this.plugin.getReadingStats();
    const groups = new Map<string, AggregatedBookStats>();
    for (const [filePath, book] of Object.entries(stats.books)) {
      const sourceTitle = getReadingStatsDisplayTitle(filePath, book.title);
      const groupKey = getReadingStatsGroupKey(filePath, book.title);
      const isSummary = isSummaryReadingStatsBook(filePath, book.title);
      const fileTags = this.plugin.getBookTags(filePath);
      const fileHasTags = hasAnyBookTags(fileTags);
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          groupKey,
          title: stripSummaryBookSuffix(sourceTitle),
          filePaths: [],
          originalFilePath: undefined,
          hasOriginalSource: false,
          hasOriginalTags: false,
          tags: createEmptyBookTags(),
          totalReadingMs: 0,
          totalReadWords: 0,
          readChapterRanges: [],
          daily: {},
          lastReadAt: 0,
        };
        groups.set(groupKey, group);
      }

      if (!isSummary && !group.hasOriginalSource) {
        group.title = sourceTitle;
        group.originalFilePath = filePath;
        group.hasOriginalSource = true;
      }
      if (!isSummary && fileHasTags && !group.hasOriginalTags) {
        group.tags = fileTags;
        group.hasOriginalTags = true;
      } else if (isSummary && fileHasTags && !group.hasOriginalTags && !hasAnyBookTags(group.tags)) {
        group.tags = fileTags;
      }
      group.filePaths.push(filePath);
      group.totalReadingMs += book.totalReadingMs;
      group.totalReadWords += book.totalReadWords;
      group.lastReadAt = Math.max(group.lastReadAt, book.lastReadAt);

      if (!isSummary) {
        group.readChapterRanges = this.mergeDisplayableChapterRanges([
          ...group.readChapterRanges,
          ...(book.readChapterRanges ?? []),
        ]);
      }

      for (const [date, daily] of Object.entries(book.daily ?? {})) {
        const groupDaily = group.daily[date] ?? { readingMs: 0, readWords: 0, readChapterRanges: [] };
        groupDaily.readingMs += daily.readingMs;
        groupDaily.readWords += daily.readWords;
        if (!isSummary) {
          groupDaily.readChapterRanges = this.mergeDisplayableChapterRanges([
            ...groupDaily.readChapterRanges,
            ...(daily.readChapterRanges ?? []),
          ]);
        }
        group.daily[date] = groupDaily;
      }
    }
    return Array.from(groups.values());
  }

  private registerBookStatsContextMenu(card: HTMLElement, groupKey: string): void {
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle('删除数据')
          .setIcon('trash')
          .onClick(() => {
            this.plugin.deleteReadingStatsGroup(groupKey)
              .then(() => {
                new Notice('已删除这组书的阅读统计');
                if (this.selectedBookPath === groupKey) this.selectedBookPath = null;
                this.globalMetric = null;
                this.bookMetric = null;
                this.render();
              })
              .catch((error) => console.error('[Puffs Reader] Failed to delete book reading stats:', error));
          });
      });
      menu.showAtMouseEvent(event);
    });
  }

  private registerBookDailyStatsContextMenu(card: HTMLElement, groupKey: string, date: string): void {
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle('删除数据')
          .setIcon('trash')
          .onClick(() => {
            this.plugin.deleteReadingStatsGroupDaily(groupKey, date)
              .then(() => {
                new Notice('已删除当天阅读统计');
                this.bookMetric = null;
                this.render();
              })
              .catch((error) => console.error('[Puffs Reader] Failed to delete book daily reading stats:', error));
          });
      });
      menu.showAtMouseEvent(event);
    });
  }

  private toggleGlobalMetric(metric: ReadingStatsMetric): void {
    this.globalMetric = this.globalMetric === metric ? null : metric;
    if (this.globalMetric === 'speed') this.speedUnit = 'hour';
    this.render();
  }

  private toggleBookMetric(metric: ReadingStatsMetric): void {
    this.bookMetric = this.bookMetric === metric ? null : metric;
    if (this.bookMetric === 'speed') this.speedUnit = 'hour';
    this.render();
  }

  private renderMetricChart(parent: HTMLElement, metric: ReadingStatsMetric, entries: Array<{ date: string; readWords: number; readingMs: number }>): void {
    const totalWords = entries.reduce((sum, item) => sum + item.readWords, 0);
    const totalMs = entries.reduce((sum, item) => sum + item.readingMs, 0);
    if (metric === 'words') {
      this.renderLineChart(
        parent,
        '累计字数',
        entries.map((item) => ({
          label: this.formatShortDate(item.date),
          value: item.readWords,
          title: `${item.date}：${this.formatCompactNumber(item.readWords)} 字`,
        })),
        (value) => `${this.formatCompactNumber(value)}字`,
        `${this.formatCompactNumber(totalWords)}字`,
      );
      return;
    }

    if (metric === 'time') {
      this.renderLineChart(
        parent,
        '累计时长',
        entries.map((item) => ({
          label: this.formatShortDate(item.date),
          value: item.readingMs / 60000,
          title: `${item.date}：${this.formatCompactDuration(item.readingMs)}`,
        })),
        (value) => this.formatChartMinutes(value),
        this.formatCompactDuration(totalMs),
      );
      return;
    }

    this.renderLineChart(
      parent,
      '平均阅读速度',
      entries.map((item) => ({
        label: this.formatShortDate(item.date),
        value: this.getSpeedValue(item.readWords, item.readingMs, this.speedUnit),
        title: `${item.date}：${this.formatSpeed(item.readWords, item.readingMs, this.speedUnit)}`,
      })),
      (value) => `${this.formatCompactNumber(value)}${this.speedUnit === 'hour' ? '字/h' : '字/min'}`,
      this.formatSpeed(totalWords, totalMs, this.speedUnit),
      (header) => this.renderSpeedUnitToggle(header),
    );
  }

  private renderSpeedUnitToggle(parent: HTMLElement): void {
    const toggle = parent.createDiv({ cls: 'puffs-reading-stats-chart-toggle' });
    for (const unit of ['hour', 'minute'] as ReadingStatsSpeedUnit[]) {
      const button = toggle.createEl('button', {
        text: unit === 'hour' ? '小时' : '分钟',
        cls: unit === this.speedUnit ? 'is-active' : '',
      });
      button.addEventListener('click', () => {
        this.speedUnit = unit;
        this.render();
      });
    }
  }

  private renderLineChart(
    parent: HTMLElement,
    title: string,
    points: ReadingStatsChartPoint[],
    formatValue: (value: number) => string,
    summaryText: string,
    renderHeaderControl?: (parent: HTMLElement) => void,
  ): void {
    const card = parent.createDiv({ cls: 'puffs-reading-stats-chart-card' });
    const header = card.createDiv({ cls: 'puffs-reading-stats-chart-header' });
    const titleWrap = header.createDiv({ cls: 'puffs-reading-stats-chart-title-wrap' });
    titleWrap.createDiv({ cls: 'puffs-reading-stats-chart-title', text: title });
    if (renderHeaderControl) renderHeaderControl(titleWrap);
    const valid = points.filter((point) => Number.isFinite(point.value));
    if (valid.length === 0 || valid.every((point) => point.value <= 0)) {
      card.createDiv({ cls: 'puffs-reading-stats-empty', text: '暂无图表数据' });
      return;
    }
    header.createDiv({ cls: 'puffs-reading-stats-chart-total', text: summaryText });

    const width = 720;
    const height = 220;
    const padLeft = 48;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 34;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;
    const maxValue = Math.max(...valid.map((point) => point.value), 1);
    const x = (idx: number) => valid.length === 1 ? padLeft + plotWidth / 2 : padLeft + (idx / (valid.length - 1)) * plotWidth;
    const y = (value: number) => padTop + plotHeight - (value / maxValue) * plotHeight;
    const path = valid.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${x(idx).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'puffs-reading-stats-chart');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);
    svg.innerHTML = `
      <line class="puffs-chart-axis" x1="${padLeft}" y1="${padTop + plotHeight}" x2="${width - padRight}" y2="${padTop + plotHeight}" />
      <line class="puffs-chart-axis" x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotHeight}" />
      <text class="puffs-chart-label" x="${padLeft}" y="${padTop + 10}">${this.escapeSvg(formatValue(maxValue))}</text>
      <text class="puffs-chart-label" x="${padLeft}" y="${height - 8}">${this.escapeSvg(valid[0].label)}</text>
      <text class="puffs-chart-label puffs-chart-label-end" x="${width - padRight}" y="${height - 8}">${this.escapeSvg(valid[valid.length - 1].label)}</text>
      <path class="puffs-chart-line" d="${path}" />
    `;
    valid.forEach((point, idx) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'puffs-chart-point');
      circle.setAttribute('cx', x(idx).toFixed(1));
      circle.setAttribute('cy', y(point.value).toFixed(1));
      circle.setAttribute('r', '3.5');
      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleEl.textContent = point.title;
      circle.appendChild(titleEl);
      svg.appendChild(circle);
    });
    card.appendChild(svg);
  }

  private formatChapterRanges(ranges: ReadChapterRange[], label = '已读章节'): string {
    const displayRanges = this.mergeDisplayableChapterRanges(ranges);
    if (displayRanges.length === 0) return '';
    const labels = displayRanges.map((range) => {
      if (range.start === range.end || range.startTitle === range.endTitle) return range.startTitle;
      return `${range.startTitle} - ${range.endTitle}`;
    });
    return `${label}：${[...new Set(labels)].join('、')}`;
  }

  private mergeDisplayableChapterRanges(ranges: ReadChapterRange[]): ReadChapterRange[] {
    const sorted = ranges
      .filter((range) =>
        Number.isFinite(range.start)
        && Number.isFinite(range.end)
        && range.start >= 0
        && range.end >= range.start
        && range.startTitle
        && range.endTitle
        && range.startTitle !== UNRECOGNIZED_CHAPTER_TITLE
        && range.endTitle !== UNRECOGNIZED_CHAPTER_TITLE
      )
      .map((range) => ({
        start: Math.floor(range.start),
        end: Math.floor(range.end),
        startTitle: range.startTitle,
        endTitle: range.endTitle,
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: ReadChapterRange[] = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (!last || range.start > last.end + 1) {
        merged.push({ ...range });
      } else if (range.end > last.end) {
        last.end = range.end;
        last.endTitle = range.endTitle;
      }
    }
    return merged;
  }

  private formatCompactDuration(ms: number): string {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 10) return `${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${totalMinutes}min`;
  }

  private formatChartMinutes(minutes: number): string {
    const totalMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(totalMinutes / 60);
    const rest = totalMinutes % 60;
    if (hours >= 10) return `${hours}h`;
    if (hours > 0) return `${hours}h ${rest}min`;
    return `${totalMinutes}min`;
  }

  private formatSpeed(words: number, ms: number, unit: ReadingStatsSpeedUnit): string {
    if (!Number.isFinite(words) || !Number.isFinite(ms) || words <= 0 || ms <= 0) return '--';
    const value = this.getSpeedValue(words, ms, unit);
    return `${this.formatCompactNumber(value)} 字/${unit === 'hour' ? '小时' : '分钟'}`;
  }

  private getSpeedValue(words: number, ms: number, unit: ReadingStatsSpeedUnit): number {
    if (!Number.isFinite(words) || !Number.isFinite(ms) || words <= 0 || ms <= 0) return 0;
    return unit === 'hour' ? words / (ms / 3600000) : words / (ms / 60000);
  }

  private formatCompactNumber(value: number): string {
    const n = Math.max(0, Math.round(value));
    if (n < 10000) return String(n);
    const compact = Math.round((n / 10000) * 10) / 10;
    return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}W`;
  }

  private formatNumber(value: number): string {
    return Math.max(0, Math.floor(value)).toLocaleString('zh-CN');
  }

  private formatDateTime(timestamp: number): string {
    if (!timestamp) return '无';
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatShortDate(date: string): string {
    return date.slice(5) || date;
  }

  private escapeSvg(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  插件主类
// ═══════════════════════════════════════════════════════════════════════

export default class PuffsReaderPlugin extends Plugin {
  settings: ReaderSettings = DEFAULT_SETTINGS;
  progress: Record<string, BookProgress> = {};
  bookSettings: Record<string, BookSettings> = {};
  tagCatalog: TagCatalog = normalizeTagCatalog(undefined);
  readingStats: ReadingStatsData = { schemaVersion: 2, books: {}, daily: {} };
  lastDataBackupAt = 0;
  knownBooks: string[] = [];
  private dataBackupTimer: number | null = null;
  private bookScanTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();

    // ── 注册阅读器视图类型（不绑定文件扩展名，改用命令触发） ──
    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));
    this.registerView(READING_STATS_VIEW_TYPE, (leaf) => new ReadingStatsView(leaf, this));

    // ── 注册命令：唤出阅读器 ──
    this.addCommand({
      id: 'open-txt-in-reader',
      name: '选择需要阅读的书籍',
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

    this.addCommand({
      id: 'show-reading-stats',
      name: '打开书架',
      callback: () => {
        this.openReadingStats();
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

  async openReadingStats(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(READING_STATS_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) {
      await leaf.setViewState({ type: READING_STATS_VIEW_TYPE, state: {} });
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (leaf.view instanceof ReadingStatsView) {
      leaf.view.showGlobalDefault();
    }
  }

  // ═══════════════════════════ 数据持久化 ═══════════════════════════

  async loadPluginData(): Promise<void> {
    const data = (await this.loadData()) as PluginData | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
    if (this.settings.tocRegex === LEGACY_DEFAULT_TOC_REGEX || this.settings.tocRegex === LEGACY_PROLOGUE_TOC_REGEX) {
      this.settings.tocRegex = DEFAULT_SETTINGS.tocRegex;
    }
    if (
      this.settings.chapterTitleRegex === LEGACY_DEFAULT_CHAPTER_TITLE_REGEX ||
      this.settings.chapterTitleRegex === LEGACY_PROLOGUE_CHAPTER_TITLE_REGEX
    ) {
      this.settings.chapterTitleRegex = DEFAULT_SETTINGS.chapterTitleRegex;
    }
    if (this.settings.readingStatsMinPageMs === 3000 || this.settings.readingStatsMinPageMs === 500) {
      this.settings.readingStatsMinPageMs = DEFAULT_SETTINGS.readingStatsMinPageMs;
    }
    this.progress = data?.progress ?? {};
    this.bookSettings = data?.bookSettings ?? {};
    this.tagCatalog = normalizeTagCatalog(data?.tagCatalog);
    this.readingStats = this.normalizeReadingStats(data?.readingStats);
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
      tagCatalog: this.tagCatalog,
      readingStats: this.readingStats,
      lastDataBackupAt: this.lastDataBackupAt,
      knownBooks: this.knownBooks,
    } as PluginData);
  }

  private normalizeReadingStats(input: ReadingStatsData | undefined): ReadingStatsData {
    if (!input || input.schemaVersion !== 2) {
      return { schemaVersion: 2, books: {}, daily: {} };
    }
    const books: ReadingStatsData['books'] = {};
    for (const [filePath, book] of Object.entries(input?.books ?? {})) {
      books[filePath] = {
        title: book.title || filePath.split('/').pop()?.replace(/\.txt$/i, '') || filePath,
        totalReadingMs: this.safeNonNegativeNumber(book.totalReadingMs),
        totalReadWords: this.safeNonNegativeNumber(book.totalReadWords),
        countedRanges: this.mergeCountedRanges(book.countedRanges ?? []),
        readChapterRanges: this.mergeChapterRanges(book.readChapterRanges ?? []),
        daily: this.normalizeBookDailyStats(book.daily),
        lastReadAt: this.safeNonNegativeNumber(book.lastReadAt),
      };
    }

    const daily: ReadingStatsData['daily'] = {};
    for (const [date, item] of Object.entries(input?.daily ?? {})) {
      daily[date] = {
        readingMs: this.safeNonNegativeNumber(item.readingMs),
        readWords: this.safeNonNegativeNumber(item.readWords),
        bookPaths: [...new Set((item.bookPaths ?? []).filter(Boolean))],
      };
    }
    return { schemaVersion: 2, books, daily };
  }

  private safeNonNegativeNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private normalizeBookDailyStats(input: Record<string, BookDailyReadingStats> | undefined): Record<string, BookDailyReadingStats> {
    const result: Record<string, BookDailyReadingStats> = {};
    for (const [date, item] of Object.entries(input ?? {})) {
      result[date] = {
        readingMs: this.safeNonNegativeNumber(item.readingMs),
        readWords: this.safeNonNegativeNumber(item.readWords),
        readChapterRanges: this.mergeChapterRanges(item.readChapterRanges ?? []),
      };
    }
    return result;
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

  getReadingStats(): ReadingStatsData {
    return this.readingStats;
  }

  async saveReadingStats(stats: ReadingStatsData): Promise<void> {
    this.readingStats = this.normalizeReadingStats(stats);
    await this.savePluginData();
  }

  async deleteReadingStatsGroup(groupKey: string): Promise<void> {
    const filePaths = this.getReadingStatsGroupFilePaths(groupKey);
    if (filePaths.length === 0) return;
    let changed = false;
    for (const filePath of filePaths) {
      changed = this.deleteBookReadingStatsInMemory(filePath) || changed;
    }
    if (changed) await this.savePluginData();
  }

  async deleteReadingStatsGroupDaily(groupKey: string, date: string): Promise<void> {
    const filePaths = this.getReadingStatsGroupFilePaths(groupKey);
    if (filePaths.length === 0) return;
    let changed = false;
    for (const filePath of filePaths) {
      changed = this.deleteBookDailyReadingStatsInMemory(filePath, date) || changed;
    }
    if (changed) await this.savePluginData();
  }

  async deleteBookReadingStats(filePath: string): Promise<void> {
    if (!this.deleteBookReadingStatsInMemory(filePath)) return;
    await this.savePluginData();
  }

  private deleteBookReadingStatsInMemory(filePath: string): boolean {
    const book = this.readingStats.books[filePath];
    if (!book) return false;
    for (const [date, item] of Object.entries(book.daily ?? {})) {
      this.removeBookContributionFromDaily(date, filePath, item.readingMs, item.readWords);
    }
    delete this.readingStats.books[filePath];
    return true;
  }

  async deleteBookDailyReadingStats(filePath: string, date: string): Promise<void> {
    if (!this.deleteBookDailyReadingStatsInMemory(filePath, date)) return;
    await this.savePluginData();
  }

  private deleteBookDailyReadingStatsInMemory(filePath: string, date: string): boolean {
    const book = this.readingStats.books[filePath];
    const daily = book?.daily?.[date];
    if (!book || !daily) return false;

    this.removeBookContributionFromDaily(date, filePath, daily.readingMs, daily.readWords);
    delete book.daily[date];

    const remainingDaily = Object.entries(book.daily ?? {});
    if (remainingDaily.length === 0) {
      delete this.readingStats.books[filePath];
      return true;
    }

    book.totalReadingMs = remainingDaily.reduce((sum, [, item]) => sum + this.safeNonNegativeNumber(item.readingMs), 0);
    book.totalReadWords = remainingDaily.reduce((sum, [, item]) => sum + this.safeNonNegativeNumber(item.readWords), 0);
    book.readChapterRanges = this.mergeChapterRanges(remainingDaily.flatMap(([, item]) => item.readChapterRanges ?? []));
    book.lastReadAt = Math.max(...remainingDaily.map(([day]) => this.getEndOfLocalDayTimestamp(day)), 0);
    this.readingStats.books[filePath] = book;
    return true;
  }

  private getReadingStatsGroupFilePaths(groupKey: string): string[] {
    const normalizedGroupKey = stripSummaryBookSuffix(groupKey.trim());
    return Object.entries(this.readingStats.books)
      .filter(([filePath, book]) =>
        filePath === groupKey
        || getReadingStatsGroupKey(filePath, book.title) === normalizedGroupKey
      )
      .map(([filePath]) => filePath);
  }

  async recordReadingStat(record: ReadingStatRecord): Promise<void> {
    const timestamp = record.timestamp ?? Date.now();
    const readingMs = this.safeNonNegativeNumber(record.readingMs);
    const readWords = this.safeNonNegativeNumber(record.readWords);
    const hasRange = !!record.countedRange && record.countedRange.end > record.countedRange.start;
    const hasChapterRanges = (record.chapterRanges?.length ?? 0) > 0;
    if (readingMs <= 0 && readWords <= 0 && !hasRange && !hasChapterRanges) return;

    const existing = this.readingStats.books[record.filePath];
    const dayKey = this.getLocalDateKey(timestamp);
    const book = existing ?? {
      title: record.title,
      totalReadingMs: 0,
      totalReadWords: 0,
      countedRanges: [],
      readChapterRanges: [],
      daily: {},
      lastReadAt: 0,
    };
    book.title = record.title || book.title;
    book.totalReadingMs += readingMs;
    book.totalReadWords += readWords;
    if (record.countedRange && record.countedRange.end > record.countedRange.start) {
      book.countedRanges = this.mergeCountedRanges([...book.countedRanges, record.countedRange]);
    }
    if (record.chapterRanges && record.chapterRanges.length > 0) {
      book.readChapterRanges = this.mergeChapterRanges([...book.readChapterRanges, ...record.chapterRanges]);
    }
    const bookDaily = book.daily[dayKey] ?? { readingMs: 0, readWords: 0, readChapterRanges: [] };
    bookDaily.readingMs += readingMs;
    bookDaily.readWords += readWords;
    if (record.chapterRanges && record.chapterRanges.length > 0) {
      bookDaily.readChapterRanges = this.mergeChapterRanges([...bookDaily.readChapterRanges, ...record.chapterRanges]);
    }
    book.daily[dayKey] = bookDaily;
    book.lastReadAt = Math.max(book.lastReadAt, timestamp);
    this.readingStats.books[record.filePath] = book;

    const daily = this.readingStats.daily[dayKey] ?? { readingMs: 0, readWords: 0, bookPaths: [] };
    daily.readingMs += readingMs;
    daily.readWords += readWords;
    if (!daily.bookPaths.includes(record.filePath)) daily.bookPaths.push(record.filePath);
    this.readingStats.daily[dayKey] = daily;

    await this.savePluginData();
  }

  private mergeCountedRanges(ranges: CountedRange[]): CountedRange[] {
    const sorted = ranges
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
      .map((range) => ({ start: Math.floor(range.start), end: Math.floor(range.end) }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: CountedRange[] = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (!last || range.start > last.end) {
        merged.push({ ...range });
      } else {
        last.end = Math.max(last.end, range.end);
      }
    }
    return merged;
  }

  private mergeChapterRanges(ranges: ReadChapterRange[]): ReadChapterRange[] {
    const sorted = ranges
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end >= range.start)
      .map((range) => ({
        start: Math.floor(range.start),
        end: Math.floor(range.end),
        startTitle: range.startTitle || '未识别章节',
        endTitle: range.endTitle || range.startTitle || '未识别章节',
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: ReadChapterRange[] = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (!last || range.start > last.end + 1) {
        merged.push({ ...range });
      } else if (range.end > last.end) {
        last.end = range.end;
        last.endTitle = range.endTitle;
      }
    }
    return merged;
  }

  private getLocalDateKey(timestamp: number): string {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getEndOfLocalDayTimestamp(date: string): number {
    const [year, month, day] = date.split('-').map((part) => Number(part));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  }

  private removeBookContributionFromDaily(date: string, filePath: string, readingMs: number, readWords: number): void {
    const daily = this.readingStats.daily[date];
    if (!daily) return;
    daily.readingMs = Math.max(0, this.safeNonNegativeNumber(daily.readingMs) - this.safeNonNegativeNumber(readingMs));
    daily.readWords = Math.max(0, this.safeNonNegativeNumber(daily.readWords) - this.safeNonNegativeNumber(readWords));
    daily.bookPaths = (daily.bookPaths ?? []).filter((path) => path !== filePath);
    if (daily.readingMs <= 0 && daily.readWords <= 0 && daily.bookPaths.length === 0) {
      delete this.readingStats.daily[date];
    } else {
      this.readingStats.daily[date] = daily;
    }
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

  getBookTags(filePath: string): BookTags {
    return normalizeBookTags(this.bookSettings[filePath]?.tags);
  }

  getTagCatalog(): TagCatalog {
    return normalizeTagCatalog(this.tagCatalog);
  }

  async addTagCatalogItem(group: TagCatalogGroup, rawValue: string): Promise<string | null> {
    const value = group === 'feature' ? normalizeAccumulationTagName(rawValue) : normalizeTagName(rawValue);
    if (!value) return null;
    const next = normalizeTagCatalog(this.tagCatalog);
    next[group] = uniqueNormalizedTags([...next[group], value]);
    this.tagCatalog = next;
    await this.savePluginData();
    return value;
  }

  async saveBookTags(filePath: string, tags: BookTags): Promise<void> {
    await this.saveBookSettings(filePath, {
      ...this.getBookSettings(filePath),
      tags: normalizeBookTags(tags),
    });
  }

  async saveBookSettings(filePath: string, settings: BookSettings): Promise<void> {
    const compact: BookSettings = {};
    if (settings.encoding) compact.encoding = settings.encoding;
    if (settings.firstLineIndent !== undefined) compact.firstLineIndent = settings.firstLineIndent;
    if (settings.tocRegex !== undefined && settings.tocRegex !== '') compact.tocRegex = settings.tocRegex;
    if (settings.chapterTitleRegex !== undefined && settings.chapterTitleRegex !== '') {
      compact.chapterTitleRegex = settings.chapterTitleRegex;
    }
    if (settings.prologueTitleRegex !== undefined && settings.prologueTitleRegex !== '') {
      compact.prologueTitleRegex = settings.prologueTitleRegex;
    }
    if (settings.removeExtraBlankLines !== undefined) {
      compact.removeExtraBlankLines = settings.removeExtraBlankLines;
    }
    if (settings.tocIndentEnabled) {
      compact.tocIndentEnabled = true;
      compact.tocIndentLevel1Regex = settings.tocIndentLevel1Regex?.trim() || '\u5377';
      compact.tocIndentLevel2Regex = settings.tocIndentLevel2Regex?.trim() || '\u7ae0';
      compact.tocIndentLevel3Regex = settings.tocIndentLevel3Regex?.trim() || '\u8282';
    }
    if (settings.annotations && settings.annotations.length > 0) {
      compact.annotations = settings.annotations;
    }
    const tags = normalizeBookTags(settings.tags);
    if (hasAnyBookTags(tags)) {
      compact.tags = tags;
    }
    this.bookSettings[filePath] = compact;
    await this.savePluginData();
  }
}
