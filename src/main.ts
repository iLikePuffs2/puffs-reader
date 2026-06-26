import { Plugin, TFile, FuzzySuggestModal, WorkspaceLeaf, normalizePath, ItemView, ViewStateResult, setIcon } from 'obsidian';
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
  BookDailyReadingStats,
  CountedRange,
  DEFAULT_SETTINGS,
  ReadChapterRange,
  ReadingStatsData,
} from './types';

const READING_STATS_VIEW_TYPE = 'puffs-reading-stats-view';
const LEGACY_DEFAULT_TOC_REGEX = '^\\s*第[零〇一二三四五六七八九十百千万亿两\\d]+[章节回卷集部篇].*$';
const LEGACY_DEFAULT_CHAPTER_TITLE_REGEX = '^\\s*第([零〇一二三四五六七八九十百千万亿两\\d]+)([章节回卷集部篇])\\s*(.*)$';
const LEGACY_PROLOGUE_TOC_REGEX = '^\\s*(?:第[零〇一二三四五六七八九十百千万亿两\\d]+[章节回卷集部篇].*|(?:序章|楔子|引子)(?:\\s+.*)?)$';
const LEGACY_PROLOGUE_CHAPTER_TITLE_REGEX = '^\\s*(?:第([零〇一二三四五六七八九十百千万亿两\\d]+)([章节回卷集部篇])\\s*(.*)|((?:序章|楔子|引子)(?:\\s+.*)?))$';

/** 插件持久化数据结构 */
interface PluginData {
  settings: ReaderSettings;
  progress: Record<string, BookProgress>;
  bookSettings?: Record<string, BookSettings>;
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

interface BookProgressMetrics {
  positionProgress: string;
  coverageProgress: string;
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
  private bookProgressMetricsCache = new Map<string, BookProgressMetrics>();

  constructor(leaf: WorkspaceLeaf, plugin: PuffsReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return READING_STATS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '阅读统计';
  }

  getIcon(): string {
    return 'bar-chart-3';
  }

  async onOpen(): Promise<void> {
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
      void this.renderBookDetail(page, this.selectedBookPath, this.renderVersion);
    } else {
      this.renderGlobal(page);
    }
  }

  private renderGlobal(parent: HTMLElement): void {
    const stats = this.plugin.getReadingStats();
    const books = Object.entries(stats.books)
      .map(([filePath, book]) => ({ filePath, book }))
      .sort((a, b) => b.book.lastReadAt - a.book.lastReadAt);
    const dailyEntries = Object.entries(stats.daily).sort((a, b) => a[0].localeCompare(b[0]));
    const totalReadingMs = dailyEntries.reduce((sum, [, item]) => sum + item.readingMs, 0);
    const totalReadWords = dailyEntries.reduce((sum, [, item]) => sum + item.readWords, 0);
    const readingDays = dailyEntries.filter(([, item]) => item.readingMs > 0 || item.readWords > 0).length;

    this.renderHeader(parent, '阅读统计');
    const summary = parent.createDiv({ cls: 'puffs-reading-stats-summary' });
    summary.addClass('is-global');
    this.createSummaryItem(summary, '阅读天数', `${readingDays} 天`);
    this.createSummaryItem(summary, '累计字数', this.formatCompactNumber(totalReadWords), 'words', this.globalMetric === 'words', () => this.toggleGlobalMetric('words'));
    this.createSummaryItem(summary, '累计时长', this.formatCompactDuration(totalReadingMs), 'time', this.globalMetric === 'time', () => this.toggleGlobalMetric('time'));
    this.createSummaryItem(summary, '平均阅读速度', this.formatSpeed(totalReadWords, totalReadingMs, 'hour'), 'speed', this.globalMetric === 'speed', () => this.toggleGlobalMetric('speed'));
    this.createSummaryItem(summary, '统计书籍', `${books.length} 本`);

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
      list.createDiv({ cls: 'puffs-reading-stats-empty', text: '暂无阅读统计。打开一本书并停留阅读后开始记录。' });
      return;
    }

    for (const { filePath, book } of books) {
      const card = list.createDiv({ cls: 'puffs-reading-stats-book' });
      const openBook = () => {
        this.selectedBookPath = filePath;
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
      const main = card.createDiv({ cls: 'puffs-reading-stats-book-main' });
      main.createDiv({ cls: 'puffs-reading-stats-book-title', text: book.title || filePath });
      const meta = main.createDiv({ cls: 'puffs-reading-stats-book-meta' });
      meta.createSpan({
        text: [
          `时长 ${this.formatCompactDuration(book.totalReadingMs)}`,
          `字数 ${this.formatCompactNumber(book.totalReadWords)}`,
          `平均阅读速度 ${this.formatSpeed(book.totalReadWords, book.totalReadingMs, 'hour')}`,
          `最近 ${this.formatDateTime(book.lastReadAt)}`,
        ].join('；'),
      });
      main.createDiv({ cls: 'puffs-reading-stats-chapters', text: this.formatChapterRanges(book.readChapterRanges) });
      const arrow = card.createSpan({ cls: 'puffs-reading-stats-book-arrow' });
      setIcon(arrow, 'chevron-right');
    }
  }

  private renderBookDetail(parent: HTMLElement, filePath: string, renderVersion: number): void {
    const stats = this.plugin.getReadingStats();
    const book = stats.books[filePath];
    if (!book) {
      this.selectedBookPath = null;
      this.renderGlobal(parent);
      return;
    }

    this.renderHeader(parent, book.title || filePath, true);
    const dailyEntries = Object.entries(book.daily ?? {}).sort((a, b) => b[0].localeCompare(a[0]));
    const readingDays = dailyEntries.filter(([, item]) => item.readingMs > 0 || item.readWords > 0).length;

    const summary = parent.createDiv({ cls: 'puffs-reading-stats-summary' });
    summary.addClass('is-detail');
    this.createSummaryItem(summary, '阅读天数', `${readingDays} 天`);
    this.createSummaryItem(summary, '累计字数', this.formatCompactNumber(book.totalReadWords), 'words', this.bookMetric === 'words', () => this.toggleBookMetric('words'));
    this.createSummaryItem(summary, '累计时长', this.formatCompactDuration(book.totalReadingMs), 'time', this.bookMetric === 'time', () => this.toggleBookMetric('time'));
    this.createSummaryItem(summary, '平均阅读速度', this.formatSpeed(book.totalReadWords, book.totalReadingMs, 'hour'), 'speed', this.bookMetric === 'speed', () => this.toggleBookMetric('speed'));

    parent.createDiv({ cls: 'puffs-reading-stats-chapters puffs-reading-stats-detail-chapters', text: this.formatChapterRanges(book.readChapterRanges) });

    if (this.bookMetric) {
      this.renderMetricChart(parent, this.bookMetric, [...dailyEntries].reverse().map(([date, item]) => ({
        date,
        readWords: item.readWords,
        readingMs: item.readingMs,
      })));
    }

    const progress = parent.createDiv({ cls: 'puffs-reading-stats-progress-grid' });
    const metrics = this.bookProgressMetricsCache.get(filePath) ?? { positionProgress: '--', coverageProgress: '--' };
    this.createProgressItem(progress, '当前位置进度', metrics.positionProgress);
    this.createProgressItem(progress, '统计覆盖进度', metrics.coverageProgress);
    this.refreshBookProgressMetrics(filePath, book, progress, renderVersion);

    this.createSectionTitle(parent, '每日明细');
    const list = parent.createDiv({ cls: 'puffs-reading-stats-list' });
    if (dailyEntries.length === 0) {
      list.createDiv({ cls: 'puffs-reading-stats-empty', text: '这本书暂无每日明细。' });
      return;
    }
    for (const [date, item] of dailyEntries) {
      const card = list.createDiv({ cls: 'puffs-reading-stats-day' });
      card.createDiv({ cls: 'puffs-reading-stats-day-title', text: date });
      const meta = card.createDiv({ cls: 'puffs-reading-stats-book-meta' });
      meta.createSpan({
        text: [
          `时长 ${this.formatCompactDuration(item.readingMs)}`,
          `字数 ${this.formatCompactNumber(item.readWords)}`,
          `平均阅读速度 ${this.formatSpeed(item.readWords, item.readingMs, 'hour')}`,
        ].join('；'),
      });
      card.createDiv({ cls: 'puffs-reading-stats-chapters', text: this.formatChapterRanges(item.readChapterRanges, '阅读章节') });
    }
  }

  private renderHeader(parent: HTMLElement, title: string, withBack = false): void {
    const header = parent.createDiv({ cls: 'puffs-reading-stats-header' });
    if (withBack) {
      const back = header.createEl('button', { cls: 'puffs-icon-btn puffs-reading-stats-back', attr: { 'aria-label': '返回阅读统计' } });
      setIcon(back, 'arrow-left');
      back.addEventListener('click', () => {
        this.selectedBookPath = null;
        this.globalMetric = null;
        this.render();
      });
    }
    header.createEl('h3', { cls: 'puffs-reading-stats-title', text: title });
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

  private createProgressItem(parent: HTMLElement, label: string, value: string): void {
    const item = parent.createDiv({ cls: 'puffs-reading-stats-progress-item' });
    const top = item.createDiv({ cls: 'puffs-reading-stats-progress-top' });
    top.createSpan({ text: label });
    top.createSpan({ text: value });
    const track = item.createDiv({ cls: 'puffs-reading-stats-progress-track' });
    const bar = track.createDiv({ cls: 'puffs-reading-stats-progress-bar' });
    bar.style.width = this.parsePercent(value);
  }

  private createSectionTitle(parent: HTMLElement, title: string): void {
    parent.createDiv({ cls: 'puffs-reading-stats-section-title', text: title });
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

  private parsePercent(value: string): string {
    const match = value.match(/([\d.]+)%/);
    if (!match) return '0%';
    const percent = Math.max(0, Math.min(100, Number(match[1])));
    return Number.isFinite(percent) ? `${percent}%` : '0%';
  }

  private refreshBookProgressMetrics(filePath: string, book: { countedRanges: CountedRange[] }, container: HTMLElement, renderVersion: number): void {
    this.getBookProgressMetrics(filePath, book)
      .then((metrics) => {
        this.bookProgressMetricsCache.set(filePath, metrics);
        if (renderVersion !== this.renderVersion || this.selectedBookPath !== filePath || !container.isConnected) return;
        container.empty();
        this.createProgressItem(container, '当前位置进度', metrics.positionProgress);
        this.createProgressItem(container, '统计覆盖进度', metrics.coverageProgress);
      })
      .catch((error) => console.error('[Puffs Reader] Failed to refresh book progress metrics:', error));
  }

  private async getBookProgressMetrics(filePath: string, book: { countedRanges: CountedRange[] }): Promise<BookProgressMetrics> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return { positionProgress: '--', coverageProgress: '--' };
    try {
      const buffer = await this.app.vault.readBinary(file);
      const encoding = this.plugin.getBookSettings(filePath).encoding ?? this.plugin.settings.defaultEncoding;
      const text = this.decodeBuffer(buffer, encoding);
      const paragraphs = this.plugin.settings.removeExtraBlankLines
        ? text.split(/\r?\n/).filter((line) => line.trim() !== '')
        : text.split(/\r?\n/);
      const progress = this.plugin.getProgress(filePath);
      const positionProgress = progress && paragraphs.length > 0
        ? `${Math.min(100, (Math.min(progress.paragraphIndex, paragraphs.length) / paragraphs.length) * 100).toFixed(1)}%`
        : '--';
      const totalChars = paragraphs.join('\n').length;
      const covered = book.countedRanges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0);
      const coverageProgress = totalChars > 0 ? `${Math.min(100, (covered / totalChars) * 100).toFixed(1)}%` : '--';
      return { positionProgress, coverageProgress };
    } catch {
      return { positionProgress: '--', coverageProgress: '--' };
    }
  }

  private decodeBuffer(buffer: ArrayBuffer, encoding: string): string {
    try {
      return new TextDecoder(encoding, { fatal: false }).decode(buffer);
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    }
  }

  private formatChapterRanges(ranges: ReadChapterRange[], label = '已读章节'): string {
    if (ranges.length === 0) return `${label}：未识别章节`;
    return `${label}：${ranges.map((range) => {
      if (range.start === range.end || range.startTitle === range.endTitle) return range.startTitle;
      return `${range.startTitle} - ${range.endTitle}`;
    }).join('、')}`;
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

    this.addCommand({
      id: 'show-reading-stats',
      name: 'Puffs Reader：阅读统计',
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
    await this.app.workspace.revealLeaf(leaf);
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
    if (settings.prologueTitleRegex !== undefined && settings.prologueTitleRegex !== '') {
      compact.prologueTitleRegex = settings.prologueTitleRegex;
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
