import { Plugin, TFile, FuzzySuggestModal, Modal, WorkspaceLeaf, normalizePath, ItemView, ViewStateResult, setIcon, Menu, Notice } from 'obsidian';
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
  DEFAULT_READING_STATUS,
  DEFAULT_SETTINGS,
  ReadChapterRange,
  ReadingStatsData,
  READING_STATUS_OPTIONS,
  SERIAL_STATUS_OPTIONS,
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
type ReadingStatsTagFilterGroup = 'genre' | 'serialStatus' | 'readingStatus' | 'feature' | 'accumulation';
type BookTagDisplayGroup = ReadingStatsTagFilterGroup | 'authors';
type EditableCatalogGroup = 'genre' | 'feature' | 'accumulation';
type BookTagArrayGroup = 'authors' | 'genre' | 'feature';
type BookSearchMode = 'title' | 'author';

interface ReadingStatsTagFilters {
  genre: Set<string>;
  serialStatus: Set<string>;
  readingStatus: Set<string>;
  feature: Set<string>;
  accumulation: Set<string>;
}

function createEmptyBookTags(): BookTags {
  return { authors: [], genre: [], feature: [], accumulation: [] };
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
  const legacyStatus = normalizeTagName(raw.status);
  const serialStatus = normalizeTagName(raw.serialStatus) || (
    SERIAL_STATUS_OPTIONS.includes(legacyStatus) ? legacyStatus : ''
  );
  const readingStatus = normalizeTagName(raw.readingStatus) || (
    READING_STATUS_OPTIONS.includes(legacyStatus) ? legacyStatus : ''
  );
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
    authors: uniqueNormalizedTags(Array.isArray(raw.authors) ? raw.authors : []),
    genre: uniqueNormalizedTags(Array.isArray(raw.genre) ? raw.genre : []),
    ...(serialStatus ? { serialStatus } : {}),
    ...(readingStatus ? { readingStatus } : {}),
    feature: uniqueNormalizedTags(Array.isArray(raw.feature) ? raw.feature : []),
    accumulation: Array.from(byName.values()),
  };
}

function hasAnyBookTags(tags: BookTags | undefined): boolean {
  const normalized = normalizeBookTags(tags);
  return normalized.authors.length > 0
    || normalized.genre.length > 0
    || !!normalized.serialStatus
    || (!!normalized.readingStatus && normalized.readingStatus !== DEFAULT_READING_STATUS)
    || normalized.feature.length > 0
    || normalized.accumulation.length > 0;
}

function normalizeTagCatalog(input: TagCatalog | undefined): TagCatalog {
  const genreValues = Array.isArray(input?.genre) ? input.genre : DEFAULT_TAG_CATALOG.genre;
  const statusValues = Array.isArray(input?.status) ? input.status : DEFAULT_TAG_CATALOG.status;
  const featureValues = Array.isArray(input?.feature) ? input.feature : DEFAULT_TAG_CATALOG.feature;
  const accumulationValues = Array.isArray(input?.accumulation)
    ? input.accumulation
    : Array.isArray(input?.feature)
      ? input.feature
      : DEFAULT_TAG_CATALOG.accumulation;
  return {
    genre: uniqueNormalizedTags(genreValues ?? []),
    status: uniqueNormalizedTags(statusValues ?? []),
    feature: uniqueNormalizedTags(featureValues ?? []),
    accumulation: uniqueNormalizedTags(accumulationValues ?? [], normalizeAccumulationTagName),
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

class BookTagsModal extends Modal {
  private plugin: PuffsReaderPlugin;
  private filePath: string;
  private draft: BookTags;
  private onSaved: () => void;
  private rangeDraftValues = new Map<string, { start: string; end: string }>();

  constructor(plugin: PuffsReaderPlugin, filePath: string, initialTags: BookTags, onSaved: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.filePath = filePath;
    this.draft = normalizeBookTags(initialTags);
    this.onSaved = onSaved;
    for (const item of this.draft.accumulation) {
      this.rangeDraftValues.set(item.name, {
        start: item.startChapter !== undefined ? String(item.startChapter) : '',
        end: item.endChapter !== undefined ? String(item.endChapter) : '',
      });
    }
  }

  onOpen(): void {
    this.modalEl.addClass('puffs-tag-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const catalog = this.plugin.getTagCatalog();
    this.contentEl.empty();
    this.contentEl.createEl('h3', { cls: 'puffs-tag-modal-title', text: '编辑相关标签' });
    const body = this.contentEl.createDiv({ cls: 'puffs-tag-modal-body' });

    this.renderTagChipSection(
      body,
      '作者',
      this.draft.authors,
      new Set(this.draft.authors),
      (tag) => this.toggleArrayTag('authors', tag),
      (value) => this.addCustomArrayTag('authors', value),
    );
    this.renderTagChipSection(
      body,
      '题材',
      this.mergeTagOptions(catalog.genre, this.draft.genre),
      new Set(this.draft.genre),
      (tag) => this.toggleArrayTag('genre', tag),
      (value) => this.addCustomArrayTag('genre', value),
    );
    this.renderTagChipSection(
      body,
      '状态',
      this.mergeTagOptions(catalog.status, this.draft.serialStatus ? [this.draft.serialStatus] : []),
      new Set(this.draft.serialStatus ? [this.draft.serialStatus] : []),
      (tag) => this.toggleSerialStatusTag(tag),
    );
    this.renderTagChipSection(
      body,
      '阅读',
      READING_STATUS_OPTIONS,
      new Set([this.draft.readingStatus || DEFAULT_READING_STATUS]),
      (tag) => this.setReadingStatusTag(tag),
    );
    this.renderTagChipSection(
      body,
      '特色',
      this.mergeTagOptions(catalog.feature, this.draft.feature),
      new Set(this.draft.feature),
      (tag) => this.toggleArrayTag('feature', tag),
      (value) => this.addCustomArrayTag('feature', value),
    );
    this.renderAccumulationTagSection(body, catalog.accumulation);
  }

  private renderTagChipSection(
    parent: HTMLElement,
    title: string,
    options: string[],
    selected: Set<string>,
    onToggle: (tag: string) => void | Promise<void>,
    onAdd?: (value: string) => void | Promise<void>,
  ): void {
    const section = parent.createDiv({ cls: 'puffs-tag-section' });
    section.createDiv({ cls: 'puffs-tag-section-title', text: title });
    const chips = section.createDiv({ cls: 'puffs-tag-chip-row' });
    for (const option of options) {
      const chip = chips.createEl('button', {
        cls: selected.has(option) ? 'puffs-tag-chip is-active' : 'puffs-tag-chip',
        text: option,
        attr: {
          type: 'button',
          'aria-pressed': selected.has(option) ? 'true' : 'false',
        },
      });
      chip.addEventListener('click', () => {
        Promise.resolve(onToggle(option)).catch((error) => {
          console.error('[Puffs Reader] Failed to update tag:', error);
          new Notice('保存标签失败');
        });
      });
    }
    if (onAdd) this.renderCustomTagInput(section, onAdd);
  }

  private renderAccumulationTagSection(parent: HTMLElement, options: string[]): void {
    const selected = new Set(this.draft.accumulation.map((tag) => tag.name));
    const section = parent.createDiv({ cls: 'puffs-tag-section' });
    section.createDiv({ cls: 'puffs-tag-section-title', text: '已积累' });
    const chips = section.createDiv({ cls: 'puffs-tag-chip-row' });
    for (const option of this.mergeTagOptions(options, this.draft.accumulation.map((tag) => tag.name))) {
      const chip = chips.createEl('button', {
        cls: selected.has(option) ? 'puffs-tag-chip is-active' : 'puffs-tag-chip',
        text: option,
        attr: {
          type: 'button',
          'aria-pressed': selected.has(option) ? 'true' : 'false',
        },
      });
      chip.addEventListener('click', () => {
        this.toggleAccumulationTag(option)
          .catch((error) => {
            console.error('[Puffs Reader] Failed to update accumulation tag:', error);
            new Notice('保存标签失败');
          });
      });
    }
    this.renderCustomTagInput(section, (value) => this.addCustomAccumulationTag(value));

    if (this.draft.accumulation.length === 0) return;

    const list = section.createDiv({ cls: 'puffs-tag-accumulation-list' });
    for (const item of this.draft.accumulation) {
      const row = list.createDiv({ cls: 'puffs-tag-accumulation-row' });
      row.createSpan({ cls: 'puffs-tag-accumulation-name', text: item.name });
      const range = this.rangeDraftValues.get(item.name);
      const startInput = row.createEl('input', {
        cls: 'puffs-tag-range-input',
        attr: { type: 'number', min: '1', step: '1', 'aria-label': `${item.name}起始章节` },
      }) as HTMLInputElement;
      startInput.value = range?.start ?? (item.startChapter !== undefined ? String(item.startChapter) : '');
      row.createSpan({ cls: 'puffs-tag-range-separator', text: '-' });
      const endInput = row.createEl('input', {
        cls: 'puffs-tag-range-input',
        attr: { type: 'number', min: '1', step: '1', 'aria-label': `${item.name}结束章节` },
      }) as HTMLInputElement;
      endInput.value = range?.end ?? (item.endChapter !== undefined ? String(item.endChapter) : '');
      const rememberRange = () => {
        this.rangeDraftValues.set(item.name, { start: startInput.value, end: endInput.value });
      };
      const saveRange = () => {
        this.updateAccumulationRange(item.name, startInput.value, endInput.value)
          .catch((error) => {
            console.error('[Puffs Reader] Failed to update accumulation range:', error);
            new Notice('保存标签失败');
          });
      };
      startInput.addEventListener('input', rememberRange);
      endInput.addEventListener('input', rememberRange);
      startInput.addEventListener('change', saveRange);
      endInput.addEventListener('change', saveRange);
      for (const input of [startInput, endInput]) {
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          saveRange();
        });
      }
    }
  }

  private renderCustomTagInput(parent: HTMLElement, onAdd: (value: string) => void | Promise<void>): void {
    const row = parent.createDiv({ cls: 'puffs-tag-custom-row' });
    const input = row.createEl('input', {
      cls: 'puffs-tag-custom-input',
      attr: { type: 'text', 'aria-label': '添加标签' },
    }) as HTMLInputElement;
    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      input.value = '';
      Promise.resolve(onAdd(value)).catch((error) => {
        console.error('[Puffs Reader] Failed to add tag:', error);
        new Notice('保存标签失败');
      });
    };
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
  }

  private mergeTagOptions(base: string[], extra: string[]): string[] {
    return uniqueNormalizedTags([...base, ...extra]);
  }

  private async addCustomArrayTag(group: BookTagArrayGroup, rawValue: string): Promise<void> {
    const value = group === 'authors' ? normalizeTagName(rawValue) : await this.plugin.addTagCatalogItem(group, rawValue);
    if (!value) return;
    const current = new Set(this.draft[group]);
    current.add(value);
    if (group === 'authors') this.draft = { ...this.draft, authors: Array.from(current) };
    else if (group === 'genre') this.draft = { ...this.draft, genre: Array.from(current) };
    else this.draft = { ...this.draft, feature: Array.from(current) };
    await this.persistDraft();
  }

  private async addCustomAccumulationTag(rawValue: string): Promise<void> {
    const value = await this.plugin.addTagCatalogItem('accumulation', rawValue);
    if (!value) return;
    if (!this.draft.accumulation.some((tag) => tag.name === value)) {
      this.draft = { ...this.draft, accumulation: [...this.draft.accumulation, { name: value }] };
    }
    await this.persistDraft();
  }

  private async toggleArrayTag(group: BookTagArrayGroup, tag: string): Promise<void> {
    const selected = new Set(this.draft[group]);
    if (selected.has(tag)) selected.delete(tag);
    else selected.add(tag);
    if (group === 'authors') this.draft = { ...this.draft, authors: Array.from(selected) };
    else if (group === 'genre') this.draft = { ...this.draft, genre: Array.from(selected) };
    else this.draft = { ...this.draft, feature: Array.from(selected) };
    await this.persistDraft();
  }

  private async toggleSerialStatusTag(tag: string): Promise<void> {
    this.draft = {
      ...this.draft,
      serialStatus: this.draft.serialStatus === tag ? undefined : tag,
    };
    await this.persistDraft();
  }

  private async setReadingStatusTag(tag: string): Promise<void> {
    this.draft = {
      ...this.draft,
      readingStatus: tag || DEFAULT_READING_STATUS,
    };
    await this.persistDraft();
  }

  private async toggleAccumulationTag(tag: string): Promise<void> {
    const exists = this.draft.accumulation.some((item) => item.name === tag);
    if (exists) {
      this.rangeDraftValues.delete(tag);
      this.draft = {
        ...this.draft,
        accumulation: this.draft.accumulation.filter((item) => item.name !== tag),
      };
    } else {
      this.draft = {
        ...this.draft,
        accumulation: [...this.draft.accumulation, { name: tag }],
      };
    }
    await this.persistDraft();
  }

  private async updateAccumulationRange(name: string, rawStart: string, rawEnd: string): Promise<void> {
    const startChapter = this.parseOptionalChapter(rawStart);
    const endChapter = this.parseOptionalChapter(rawEnd);
    if (startChapter === null || endChapter === null) {
      new Notice('章节范围必须是正整数');
      this.render();
      return;
    }
    if (startChapter !== undefined && endChapter !== undefined && endChapter < startChapter) {
      new Notice('结束章节不能小于起始章节');
      this.render();
      return;
    }
    this.rangeDraftValues.set(name, { start: rawStart, end: rawEnd });
    this.draft = {
      ...this.draft,
      accumulation: this.draft.accumulation.map((item) => item.name === name
        ? {
            name: item.name,
            ...(startChapter !== undefined ? { startChapter } : {}),
            ...(endChapter !== undefined ? { endChapter } : {}),
          }
        : item),
    };
    await this.persistDraft();
  }

  private collectDraftTags(): BookTags | null {
    const accumulation: BookTags['accumulation'] = [];
    for (const item of this.draft.accumulation) {
      const range = this.rangeDraftValues.get(item.name) ?? {
        start: item.startChapter !== undefined ? String(item.startChapter) : '',
        end: item.endChapter !== undefined ? String(item.endChapter) : '',
      };
      const startChapter = this.parseOptionalChapter(range.start);
      const endChapter = this.parseOptionalChapter(range.end);
      if (startChapter === null || endChapter === null) {
        new Notice('章节范围必须是正整数');
        return null;
      }
      if (startChapter !== undefined && endChapter !== undefined && endChapter < startChapter) {
        new Notice('结束章节不能小于起始章节');
        return null;
      }
      accumulation.push({
        name: item.name,
        ...(startChapter !== undefined ? { startChapter } : {}),
        ...(endChapter !== undefined ? { endChapter } : {}),
      });
    }
    return normalizeBookTags({ ...this.draft, accumulation });
  }

  private parseOptionalChapter(value: string): number | undefined | null {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  private async persistDraft(): Promise<void> {
    const tags = this.collectDraftTags();
    if (!tags) return;
    await this.plugin.saveBookTags(this.filePath, tags);
    this.draft = tags;
    this.onSaved();
    this.render();
  }
}

class GlobalTagCatalogModal extends Modal {
  private plugin: PuffsReaderPlugin;
  private onSaved: () => void;

  constructor(plugin: PuffsReaderPlugin, onSaved: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.onSaved = onSaved;
  }

  onOpen(): void {
    this.modalEl.addClass('puffs-tag-modal');
    this.modalEl.addClass('puffs-catalog-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const catalog = this.plugin.getTagCatalog();
    this.contentEl.empty();
    this.contentEl.createEl('h3', { cls: 'puffs-tag-modal-title', text: '编辑全局标签' });
    const body = this.contentEl.createDiv({ cls: 'puffs-tag-modal-body' });
    this.renderCatalogGroup(body, '题材', 'genre', catalog.genre);
    this.renderCatalogGroup(body, '特色', 'feature', catalog.feature);
    this.renderCatalogGroup(body, '已积累', 'accumulation', catalog.accumulation);
  }

  private renderCatalogGroup(parent: HTMLElement, title: string, group: EditableCatalogGroup, values: string[]): void {
    const section = parent.createDiv({ cls: 'puffs-tag-section puffs-catalog-section' });
    section.createDiv({ cls: 'puffs-tag-section-title', text: title });
    const list = section.createDiv({ cls: 'puffs-catalog-list' });
    if (values.length === 0) {
      list.createDiv({ cls: 'puffs-tag-empty', text: '暂无标签' });
    }
    for (const value of values) {
      const row = list.createDiv({ cls: 'puffs-catalog-row' });
      const input = row.createEl('input', {
        cls: 'puffs-catalog-input',
        attr: { type: 'text', 'aria-label': `${title}标签名` },
      }) as HTMLInputElement;
      input.value = value;
      const saveBtn = row.createEl('button', {
        cls: 'puffs-icon-btn puffs-catalog-btn',
        attr: { type: 'button', 'aria-label': `重命名${value}` },
      });
      setIcon(saveBtn, 'check');
      const removeBtn = row.createEl('button', {
        cls: 'puffs-icon-btn puffs-catalog-btn',
        attr: { type: 'button', 'aria-label': `删除${value}` },
      });
      setIcon(removeBtn, 'trash');
      const save = () => {
        const next = input.value.trim();
        if (!next || next === value) {
          input.value = value;
          return;
        }
        this.plugin.renameTagCatalogItem(group, value, next)
          .then(() => this.afterSaved())
          .catch((error) => {
            console.error('[Puffs Reader] Failed to rename global tag:', error);
            new Notice('保存全局标签失败');
          });
      };
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        save();
      });
      input.addEventListener('change', save);
      saveBtn.addEventListener('click', save);
      removeBtn.addEventListener('click', () => {
        this.plugin.deleteTagCatalogItem(group, value)
          .then(() => this.afterSaved())
          .catch((error) => {
            console.error('[Puffs Reader] Failed to delete global tag:', error);
            new Notice('删除全局标签失败');
          });
      });
    }
    this.renderAddRow(section, group);
  }

  private renderAddRow(parent: HTMLElement, group: EditableCatalogGroup): void {
    const row = parent.createDiv({ cls: 'puffs-catalog-row puffs-catalog-add-row' });
    const input = row.createEl('input', {
      cls: 'puffs-catalog-input',
      attr: { type: 'text', 'aria-label': '添加全局标签' },
    }) as HTMLInputElement;
    const addBtn = row.createEl('button', {
      cls: 'puffs-icon-btn puffs-catalog-btn',
      attr: { type: 'button', 'aria-label': '添加全局标签' },
    });
    setIcon(addBtn, 'plus');
    const add = () => {
      const value = input.value.trim();
      if (!value) return;
      this.plugin.addTagCatalogItem(group, value)
        .then((saved) => {
          if (!saved) return;
          input.value = '';
          this.afterSaved();
        })
        .catch((error) => {
          console.error('[Puffs Reader] Failed to add global tag:', error);
          new Notice('添加全局标签失败');
        });
    };
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      add();
    });
    addBtn.addEventListener('click', add);
  }

  private afterSaved(): void {
    this.onSaved();
    this.render();
  }
}

class ReadingStatsView extends ItemView {
  private plugin: PuffsReaderPlugin;
  private selectedBookPath: string | null = null;
  private renderVersion = 0;
  private globalMetric: ReadingStatsMetric | null = null;
  private bookMetric: ReadingStatsMetric | null = null;
  private speedUnit: ReadingStatsSpeedUnit = 'hour';
  private untaggedOnly = false;
  private bookSearchOpen = false;
  private bookSearchQuery = '';
  private bookSearchMode: BookSearchMode = 'title';
  private lastBookDetailPath: string | null = null;
  private globalBookSectionTitleEl: HTMLElement | null = null;
  private globalBookListEl: HTMLElement | null = null;
  private globalSummaryBookCountEl: HTMLElement | null = null;
  private tagFilters: ReadingStatsTagFilters = {
    genre: new Set<string>(),
    serialStatus: new Set<string>(),
    readingStatus: new Set<string>(),
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
    const handleForwardHotkey = (event: KeyboardEvent) => this.handleBookDetailForwardHotkey(event);
    const handleSearchHotkey = (event: KeyboardEvent) => this.handleBookSearchHotkey(event);
    window.addEventListener('keydown', handleBackHotkey, true);
    document.addEventListener('keydown', handleBackHotkey, true);
    window.addEventListener('keydown', handleForwardHotkey, true);
    document.addEventListener('keydown', handleForwardHotkey, true);
    window.addEventListener('keydown', handleSearchHotkey, true);
    document.addEventListener('keydown', handleSearchHotkey, true);
    this.register(() => {
      window.removeEventListener('keydown', handleBackHotkey, true);
      document.removeEventListener('keydown', handleBackHotkey, true);
      window.removeEventListener('keydown', handleForwardHotkey, true);
      document.removeEventListener('keydown', handleForwardHotkey, true);
      window.removeEventListener('keydown', handleSearchHotkey, true);
      document.removeEventListener('keydown', handleSearchHotkey, true);
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
    this.globalBookSectionTitleEl = null;
    this.globalBookListEl = null;
    this.globalSummaryBookCountEl = null;
    this.contentEl.addClass('puffs-reading-stats-view');
    const page = this.contentEl.createDiv({ cls: 'puffs-reading-stats-page' });
    if (this.selectedBookPath) {
      this.renderBookDetail(page, this.selectedBookPath);
    } else {
      this.renderGlobal(page);
    }
  }

  private renderGlobal(parent: HTMLElement): void {
    const state = this.getGlobalBookListState();
    const dailyEntries = this.getDailyEntriesForBooks(state.books).sort((a, b) => a[0].localeCompare(b[0]));
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
    this.globalSummaryBookCountEl = this.createSummaryItem(summary, '统计书籍', `${state.books.length} 本`);

    this.renderTagFilters(parent, state.filterOptionBooks);

    if (this.globalMetric) {
      this.renderMetricChart(parent, this.globalMetric, dailyEntries.map(([date, item]) => ({
        date,
        readWords: item.readWords,
        readingMs: item.readingMs,
      })));
    }

    this.globalBookSectionTitleEl = this.createSectionTitle(parent, state.useFullLibrary ? '书籍列表' : '最近阅读', (actions) => this.renderBookSearchActions(actions));
    this.globalBookListEl = parent.createDiv({ cls: 'puffs-reading-stats-list' });
    this.renderGlobalBookList(this.globalBookListEl, state);
  }

  private getGlobalBookListState(): {
    hasFilters: boolean;
    hasSearch: boolean;
    useFullLibrary: boolean;
    filterOptionBooks: AggregatedBookStats[];
    books: AggregatedBookStats[];
  } {
    const hasFilters = this.hasActiveTagFilters();
    const hasSearch = this.hasActiveBookSearch();
    const useFullLibrary = hasFilters || hasSearch;
    const filterOptionBooks = this.getAggregatedBooks(true).sort((a, b) => b.lastReadAt - a.lastReadAt);
    const allBooks = (useFullLibrary ? filterOptionBooks : this.getAggregatedBooks(false))
      .sort((a, b) => b.lastReadAt - a.lastReadAt);
    const books = allBooks
      .filter((book) => this.matchesTagFilters(book))
      .filter((book) => this.matchesBookSearch(book));
    return { hasFilters, hasSearch, useFullLibrary, filterOptionBooks, books };
  }

  private refreshGlobalBookList(): void {
    const state = this.getGlobalBookListState();
    this.globalBookSectionTitleEl?.setText(state.useFullLibrary ? '书籍列表' : '最近阅读');
    this.globalSummaryBookCountEl?.setText(`${state.books.length} 本`);
    if (!this.globalBookListEl) return;
    this.globalBookListEl.empty();
    this.renderGlobalBookList(this.globalBookListEl, state);
  }

  private renderGlobalBookList(
    list: HTMLElement,
    state: { hasFilters: boolean; hasSearch: boolean; books: AggregatedBookStats[] },
  ): void {
    if (state.books.length === 0) {
      list.createDiv({
        cls: 'puffs-reading-stats-empty',
        text: state.hasFilters
          ? this.untaggedOnly
            ? '书库里没有未打标签的书籍。'
            : '没有匹配当前标签筛选的书籍。'
          : state.hasSearch
            ? '没有匹配当前搜索的书籍。'
            : '暂无阅读统计。打开一本书并停留阅读后开始记录。',
      });
      return;
    }

    for (const book of state.books) {
      const card = list.createDiv({ cls: 'puffs-reading-stats-book' });
      const openBook = () => {
        this.selectedBookPath = book.groupKey;
        this.lastBookDetailPath = book.groupKey;
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
      this.renderBookTagBadges(main, book.tags, ['genre', 'serialStatus', 'readingStatus', 'feature']);
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
    const books = this.getAggregatedBooks(true);
    const book = books.find((item) => item.groupKey === groupKey) ?? books.find((item) => item.filePaths.includes(groupKey));
    if (!book) {
      this.selectedBookPath = null;
      this.renderGlobal(parent);
      return;
    }
    this.selectedBookPath = book.groupKey;
    this.lastBookDetailPath = book.groupKey;

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

    this.createSectionTitle(parent, '相关标签', (actions) => {
      this.renderEditBookTagsButton(actions, book);
    });
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
    header.createEl('h3', { cls: 'puffs-reading-stats-title', text: title });
    const actions = header.createDiv({ cls: 'puffs-reading-stats-header-actions' });
    if (renderActions) renderActions(actions);
    if (withBack) this.renderBackButton(actions);
  }

  private renderBackButton(parent: HTMLElement): void {
    const back = parent.createEl('button', {
      cls: 'puffs-icon-btn puffs-reading-stats-action puffs-reading-stats-back',
      attr: { 'aria-label': '返回阅读统计' },
    });
    setIcon(back, 'arrow-left');
    back.addEventListener('click', () => {
      this.goBackToGlobal();
    });
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

  private renderEditBookTagsButton(parent: HTMLElement, book: AggregatedBookStats): void {
    const button = parent.createEl('button', {
      cls: 'puffs-icon-btn puffs-reading-stats-section-action',
      attr: { 'aria-label': '编辑相关标签' },
    });
    setIcon(button, 'pencil');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openBookTagsModal(book);
    });
  }

  private openBookTagsModal(book: AggregatedBookStats): void {
    const file = this.getEditableBookTagFile(book);
    if (!file) {
      new Notice('未找到可编辑的原书文件');
      return;
    }
    new BookTagsModal(this.plugin, file.path, book.tags, () => this.render()).open();
  }

  private getEditableBookTagFile(book: AggregatedBookStats): TFile | null {
    const candidates = [book.originalFilePath, ...book.filePaths].filter((path): path is string => !!path);
    const seen = new Set<string>();
    for (const filePath of candidates) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) return file;
    }
    return null;
  }

  private handleBookDetailBackHotkey(event: KeyboardEvent): void {
    if (!this.selectedBookPath) return;
    if (!event.altKey || event.key !== 'ArrowLeft' || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!this.isActiveStatsView()) return;
    event.preventDefault();
    event.stopPropagation();
    this.goBackToGlobal();
  }

  private handleBookDetailForwardHotkey(event: KeyboardEvent): void {
    if (this.selectedBookPath || !this.lastBookDetailPath) return;
    if (!event.altKey || event.key !== 'ArrowRight' || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!this.isActiveStatsView()) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedBookPath = this.lastBookDetailPath;
    this.render();
  }

  private handleBookSearchHotkey(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== 'f' || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return;
    if (this.selectedBookPath) return;
    if (!this.isActiveStatsView()) return;
    event.preventDefault();
    event.stopPropagation();
    this.bookSearchOpen = !this.bookSearchOpen;
    this.globalMetric = null;
    this.render();
  }

  private isActiveStatsView(): boolean {
    return this.app.workspace.getActiveViewOfType(ReadingStatsView) === this
      || !!this.contentEl.closest('.workspace-leaf.mod-active')
      || this.contentEl.contains(document.activeElement);
  }

  private goBackToGlobal(): void {
    this.selectedBookPath = null;
    this.globalMetric = null;
    this.bookMetric = null;
    this.render();
  }

  private createSummaryItem(
    parent: HTMLElement,
    label: string,
    value: string,
    metric?: ReadingStatsMetric,
    active = false,
    onClick?: () => void,
  ): HTMLElement {
    const item = parent.createDiv({ cls: 'puffs-reading-stats-summary-item' });
    if (metric) {
      item.addClass('is-clickable');
      item.setAttr('tabindex', '0');
      item.setAttr('role', 'button');
      item.setAttr('aria-pressed', active ? 'true' : 'false');
    }
    if (active) item.addClass('is-active');
    item.createDiv({ cls: 'puffs-reading-stats-summary-label', text: label });
    const valueEl = item.createDiv({ cls: 'puffs-reading-stats-summary-value', text: value });
    if (onClick) {
      item.addEventListener('click', onClick);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      });
    }
    return valueEl;
  }

  private createSectionTitle(parent: HTMLElement, title: string, renderActions?: (actions: HTMLElement) => void): HTMLElement {
    if (!renderActions) {
      return parent.createDiv({ cls: 'puffs-reading-stats-section-title', text: title });
    }
    const row = parent.createDiv({ cls: 'puffs-reading-stats-section-title-row' });
    const titleEl = row.createDiv({ cls: 'puffs-reading-stats-section-title', text: title });
    const actions = row.createDiv({ cls: 'puffs-reading-stats-section-actions' });
    renderActions(actions);
    return titleEl;
  }

  private renderBookSearchActions(parent: HTMLElement): void {
    const searchWrap = parent.createDiv({ cls: 'puffs-reading-stats-book-search' });
    if (this.bookSearchOpen) {
      const input = searchWrap.createEl('input', {
        cls: 'puffs-reading-stats-book-search-input',
        attr: {
          type: 'text',
          placeholder: this.bookSearchMode === 'author' ? '搜索作者' : '搜索书名',
          'aria-label': this.bookSearchMode === 'author' ? '按作者名搜索' : '按书名搜索',
        },
      }) as HTMLInputElement;
      input.value = this.bookSearchQuery;
      let isComposing = false;
      const commitSearchValue = () => {
        this.bookSearchQuery = input.value.trim();
        this.globalMetric = null;
        this.refreshGlobalBookList();
      };
      input.addEventListener('compositionstart', () => {
        isComposing = true;
      });
      input.addEventListener('compositionend', () => {
        isComposing = false;
        commitSearchValue();
      });
      input.addEventListener('input', () => {
        if (isComposing) return;
        commitSearchValue();
      });
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (!input.isConnected || parent.contains(document.activeElement)) return;
          this.bookSearchOpen = false;
          this.render();
        }, 0);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (this.bookSearchQuery) this.clearBookSearch();
        else this.bookSearchOpen = false;
        this.render();
      });
      window.setTimeout(() => {
        if (input.isConnected) input.focus();
      }, 0);
    } else {
      const searchBtn = searchWrap.createEl('button', {
        cls: 'puffs-icon-btn puffs-reading-stats-section-action',
        attr: { type: 'button', 'aria-label': '搜索书籍' },
      });
      setIcon(searchBtn, 'search');
      searchBtn.addEventListener('click', () => {
        this.bookSearchOpen = true;
        this.render();
      });
    }

    const authorBtn = parent.createEl('button', {
      cls: this.bookSearchMode === 'author'
        ? 'puffs-icon-btn puffs-reading-stats-section-action is-active'
        : 'puffs-icon-btn puffs-reading-stats-section-action',
      attr: {
        type: 'button',
        'aria-label': '按作者名搜索',
        'aria-pressed': this.bookSearchMode === 'author' ? 'true' : 'false',
      },
    });
    setIcon(authorBtn, 'user');
    authorBtn.addEventListener('click', () => {
      this.bookSearchMode = this.bookSearchMode === 'author' ? 'title' : 'author';
      this.globalMetric = null;
      this.render();
    });
  }

  private clearBookSearch(): void {
    this.bookSearchQuery = '';
    this.bookSearchOpen = false;
    this.globalMetric = null;
  }

  private hasActiveBookSearch(): boolean {
    return this.bookSearchQuery.trim().length > 0;
  }

  private matchesBookSearch(book: AggregatedBookStats): boolean {
    const query = this.bookSearchQuery.trim().toLowerCase();
    if (!query) return true;
    if (this.bookSearchMode === 'author') {
      return normalizeBookTags(book.tags).authors.some((author) => author.toLowerCase().includes(query));
    }
    return book.title.toLowerCase().includes(query);
  }

  private renderGlobalTagManagerButton(parent: HTMLElement): void {
    const button = parent.createEl('button', {
      cls: 'puffs-icon-btn puffs-reading-stats-filter-action',
      attr: { type: 'button', 'aria-label': '编辑全局标签' },
    });
    setIcon(button, 'list-plus');
    button.addEventListener('click', () => {
      new GlobalTagCatalogModal(this.plugin, () => this.render()).open();
    });
  }

  private renderTagFilters(parent: HTMLElement, books: AggregatedBookStats[]): void {
    const options = this.getTagFilterOptions(books);
    const hasOptions = options.genre.length > 0
      || options.serialStatus.length > 0
      || options.readingStatus.length > 0
      || options.feature.length > 0
      || options.accumulation.length > 0;
    if (!hasOptions && !this.hasActiveTagFilters()) return;

    const titleRow = parent.createDiv({ cls: 'puffs-reading-stats-filter-title-row' });
    const titleActions = titleRow.createDiv({ cls: 'puffs-reading-stats-filter-title-actions' });
    titleActions.createDiv({ cls: 'puffs-reading-stats-title puffs-reading-stats-filter-title', text: '标签筛选' });
    const untaggedBtn = titleActions.createEl('button', {
      cls: this.untaggedOnly
        ? 'puffs-icon-btn puffs-reading-stats-filter-action is-active'
        : 'puffs-icon-btn puffs-reading-stats-filter-action',
      attr: {
        type: 'button',
        'aria-label': '筛选书库里所有未打标签的书籍',
        'aria-pressed': this.untaggedOnly ? 'true' : 'false',
      },
    });
    setIcon(untaggedBtn, 'tags');
    untaggedBtn.addEventListener('click', () => {
      this.toggleUntaggedOnly();
      this.render();
    });
    this.renderGlobalTagManagerButton(titleActions);

    const panel = parent.createDiv({ cls: 'puffs-reading-stats-tag-filter' });
    const clearBtn = panel.createEl('button', {
      cls: 'puffs-icon-btn puffs-reading-stats-tag-clear',
      attr: { type: 'button', 'aria-label': '清除标签筛选' },
    });
    setIcon(clearBtn, 'trash-2');
    const hasFilters = this.hasActiveTagFilters();
    clearBtn.classList.toggle('is-hidden', !hasFilters);
    clearBtn.disabled = !hasFilters;
    clearBtn.addEventListener('click', () => {
      this.clearTagFilters();
      this.render();
    });

    this.renderTagFilterGroup(panel, '题材', 'genre', options.genre);
    this.renderTagFilterGroup(panel, '状态', 'serialStatus', options.serialStatus);
    this.renderTagFilterGroup(panel, '阅读', 'readingStatus', options.readingStatus);
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
      serialStatus: uniqueNormalizedTags([...catalog.status, ...books.map((book) => book.tags.serialStatus ?? '')]),
      readingStatus: uniqueNormalizedTags([
        ...READING_STATUS_OPTIONS,
        ...books.map((book) => book.tags.readingStatus || DEFAULT_READING_STATUS),
      ]),
      feature: uniqueNormalizedTags([...catalog.feature, ...books.flatMap((book) => book.tags.feature)]),
      accumulation: uniqueNormalizedTags([
        ...catalog.accumulation,
        ...books.flatMap((book) => book.tags.accumulation.map((tag) => tag.name)),
      ]),
    };
  }

  private toggleTagFilter(group: ReadingStatsTagFilterGroup, value: string): void {
    this.untaggedOnly = false;
    const filters = this.tagFilters[group];
    if (filters.has(value)) filters.delete(value);
    else filters.add(value);
    this.globalMetric = null;
  }

  private clearTagFilters(): void {
    for (const filters of Object.values(this.tagFilters)) filters.clear();
    this.untaggedOnly = false;
    this.globalMetric = null;
  }

  private hasActiveTagFilters(): boolean {
    return this.untaggedOnly || Object.values(this.tagFilters).some((filters) => filters.size > 0);
  }

  private matchesTagFilters(book: AggregatedBookStats): boolean {
    if (this.untaggedOnly) return !hasAnyBookTags(book.tags);
    const tags = normalizeBookTags(book.tags);
    return this.matchesTagFilterGroup(this.tagFilters.genre, tags.genre)
      && this.matchesTagFilterGroup(this.tagFilters.serialStatus, tags.serialStatus ? [tags.serialStatus] : [])
      && this.matchesTagFilterGroup(this.tagFilters.readingStatus, [tags.readingStatus || DEFAULT_READING_STATUS])
      && this.matchesTagFilterGroup(this.tagFilters.feature, tags.feature)
      && this.matchesTagFilterGroup(this.tagFilters.accumulation, tags.accumulation.map((tag) => tag.name));
  }

  private matchesTagFilterGroup(filters: Set<string>, values: string[]): boolean {
    return filters.size === 0 || values.some((value) => filters.has(value));
  }

  private toggleUntaggedOnly(): void {
    const next = !this.untaggedOnly;
    this.clearTagFilters();
    this.untaggedOnly = next;
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
    groups: BookTagDisplayGroup[] = ['authors', 'genre', 'serialStatus', 'readingStatus', 'feature', 'accumulation'],
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

  private getBookTagGroups(tags: BookTags): Array<{ group: BookTagDisplayGroup; label: string; labels: string[] }> {
    const normalized = normalizeBookTags(tags);
    return [
      { group: 'authors' as const, label: '作者', labels: normalized.authors },
      { group: 'genre' as const, label: '题材', labels: normalized.genre },
      { group: 'serialStatus' as const, label: '状态', labels: normalized.serialStatus ? [normalized.serialStatus] : [] },
      { group: 'readingStatus' as const, label: '阅读', labels: [normalized.readingStatus || DEFAULT_READING_STATUS] },
      { group: 'feature' as const, label: '特色', labels: normalized.feature },
      {
        group: 'accumulation' as const,
        label: '已积累',
        labels: normalized.accumulation.map((tag) => formatAccumulationTagLabel(tag)),
      },
    ];
  }

  private getAggregatedBooks(includeLibraryBooks = false): AggregatedBookStats[] {
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
    if (includeLibraryBooks) {
      for (const file of this.plugin.getSelectableBookFiles()) {
        const groupKey = getReadingStatsGroupKey(file.path, file.basename);
        const fileTags = this.plugin.getBookTags(file.path);
        const fileHasTags = hasAnyBookTags(fileTags);
        const group = groups.get(groupKey);
        if (group) {
          if (!group.originalFilePath) group.originalFilePath = file.path;
          if (!group.hasOriginalSource) {
            group.title = file.basename;
            group.filePaths.push(file.path);
            group.hasOriginalSource = true;
          }
          group.lastReadAt = Math.max(group.lastReadAt, this.plugin.getProgress(file.path)?.lastRead ?? 0);
          if (fileHasTags && !group.hasOriginalTags) {
            group.tags = fileTags;
            group.hasOriginalTags = true;
          }
          continue;
        }
        groups.set(groupKey, {
          groupKey,
          title: file.basename,
          filePaths: [file.path],
          originalFilePath: file.path,
          hasOriginalSource: true,
          hasOriginalTags: fileHasTags,
          tags: fileTags,
          totalReadingMs: 0,
          totalReadWords: 0,
          readChapterRanges: [],
          daily: {},
          lastReadAt: this.plugin.getProgress(file.path)?.lastRead ?? 0,
        });
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
    const value = group === 'accumulation' ? normalizeAccumulationTagName(rawValue) : normalizeTagName(rawValue);
    if (!value) return null;
    const next = normalizeTagCatalog(this.tagCatalog);
    next[group] = uniqueNormalizedTags([...next[group], value]);
    this.tagCatalog = next;
    await this.savePluginData();
    return value;
  }

  async renameTagCatalogItem(group: EditableCatalogGroup, oldRawValue: string, newRawValue: string): Promise<void> {
    const oldValue = this.normalizeCatalogValue(group, oldRawValue);
    const newValue = this.normalizeCatalogValue(group, newRawValue);
    if (!oldValue || !newValue || oldValue === newValue) return;

    const nextCatalog = normalizeTagCatalog(this.tagCatalog);
    nextCatalog[group] = uniqueNormalizedTags(nextCatalog[group].map((value) => value === oldValue ? newValue : value));
    this.tagCatalog = nextCatalog;

    for (const [filePath, settings] of Object.entries(this.bookSettings)) {
      const tags = normalizeBookTags(settings.tags);
      const nextTags = this.renameBookTag(tags, group, oldValue, newValue);
      if (nextTags === tags) continue;
      this.bookSettings[filePath] = { ...settings, tags: nextTags };
    }
    await this.savePluginData();
  }

  async deleteTagCatalogItem(group: EditableCatalogGroup, rawValue: string): Promise<void> {
    const value = this.normalizeCatalogValue(group, rawValue);
    if (!value) return;

    const nextCatalog = normalizeTagCatalog(this.tagCatalog);
    nextCatalog[group] = nextCatalog[group].filter((item) => item !== value);
    this.tagCatalog = nextCatalog;

    for (const [filePath, settings] of Object.entries(this.bookSettings)) {
      const tags = normalizeBookTags(settings.tags);
      const nextTags = this.deleteBookTag(tags, group, value);
      if (nextTags === tags) continue;
      this.bookSettings[filePath] = { ...settings, tags: nextTags };
    }
    await this.savePluginData();
  }

  private normalizeCatalogValue(group: EditableCatalogGroup, rawValue: string): string {
    return group === 'accumulation' ? normalizeAccumulationTagName(rawValue) : normalizeTagName(rawValue);
  }

  private renameBookTag(tags: BookTags, group: EditableCatalogGroup, oldValue: string, newValue: string): BookTags {
    if (group === 'accumulation') {
      let changed = false;
      const byName = new Map<string, BookTags['accumulation'][number]>();
      for (const item of tags.accumulation) {
        const name = item.name === oldValue ? newValue : item.name;
        if (name !== item.name) changed = true;
        if (!byName.has(name)) byName.set(name, { ...item, name });
      }
      return changed ? { ...tags, accumulation: Array.from(byName.values()) } : tags;
    }

    const current = tags[group];
    if (!current.includes(oldValue)) return tags;
    return { ...tags, [group]: uniqueNormalizedTags(current.map((value) => value === oldValue ? newValue : value)) };
  }

  private deleteBookTag(tags: BookTags, group: EditableCatalogGroup, value: string): BookTags {
    if (group === 'accumulation') {
      if (!tags.accumulation.some((item) => item.name === value)) return tags;
      return { ...tags, accumulation: tags.accumulation.filter((item) => item.name !== value) };
    }

    if (!tags[group].includes(value)) return tags;
    return { ...tags, [group]: tags[group].filter((item) => item !== value) };
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
