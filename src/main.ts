import { Plugin, TFile, FuzzySuggestModal, Modal, WorkspaceLeaf, normalizePath, ItemView, ViewStateResult, setIcon, Menu, Notice, Scope } from 'obsidian';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { dirname, isAbsolute, join, resolve } from 'path';

const execAsync = promisify(exec);
import { ReaderView, READER_VIEW_TYPE } from './ReaderView';
import { SettingsTab } from './SettingsTab';
import { TagInputSuggest } from './TagInputSuggest';
import {
  ReaderSettings,
  BookProgress,
  BookSettings,
  BookTags,
  BookWordCountCacheEntry,
  DEFAULT_TAG_CATALOG,
  DEFAULT_READING_STATUS,
  DEFAULT_SETTINGS,
  ReadingStatsData,
  READING_STATUS_OPTIONS,
  SERIAL_STATUS_OPTIONS,
  TagCatalog,
} from './types';
import { decodeTxtBuffer } from './textEncoding';

const READING_STATS_VIEW_TYPE = 'puffs-reading-stats-view';
const LEGACY_DEFAULT_TOC_REGEX = '^\\s*第[零〇一二三四五六七八九十百千万亿两\\d]+[章节回卷集部篇].*$';
const LEGACY_DEFAULT_CHAPTER_TITLE_REGEX = '^\\s*第([零〇一二三四五六七八九十百千万亿两\\d]+)([章节回卷集部篇])\\s*(.*)$';
const LEGACY_PROLOGUE_TOC_REGEX = '^\\s*(?:第[零〇一二三四五六七八九十百千万亿两\\d]+[章节回卷集部篇].*|(?:序章|楔子|引子)(?:\\s+.*)?)$';
const LEGACY_PROLOGUE_CHAPTER_TITLE_REGEX = '^\\s*(?:第([零〇一二三四五六七八九十百千万亿两\\d]+)([章节回卷集部篇])\\s*(.*)|((?:序章|楔子|引子)(?:\\s+.*)?))$';
const SUMMARY_BOOK_SUFFIX = '-概括版';

type TagCatalogGroup = keyof TagCatalog;
type ReadingStatsTagFilterGroup = 'genre' | 'serialStatus' | 'readingStatus' | 'feature' | 'accumulation';
type BookTagDisplayGroup = ReadingStatsTagFilterGroup | 'authors';
type EditableCatalogGroup = 'genre' | 'feature' | 'accumulation';
type EditableGlobalTagGroup = EditableCatalogGroup | 'authors';
type BookTagArrayGroup = 'authors' | 'genre' | 'feature';
type BookSearchMode = 'title' | 'author';

interface CustomTagInputOptions {
  ariaLabel?: string;
  placeholder?: string;
  suggestions?: string[];
  submitOnBlur?: boolean;
}

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

function matchesHotkey(event: KeyboardEvent, raw: string): boolean {
  const parts = raw.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean);
  const key = parts.find((part) => !['ctrl', 'control', 'cmd', 'meta', 'alt', 'shift'].includes(part));
  if (!key) return false;
  const eventKey = event.key.toLowerCase();
  const eventCode = event.code.toLowerCase().replace(/^key/, '');
  return (
    (eventKey === key || eventCode === key)
    && event.ctrlKey === (parts.includes('ctrl') || parts.includes('control'))
    && event.metaKey === (parts.includes('cmd') || parts.includes('meta'))
    && event.altKey === parts.includes('alt')
    && event.shiftKey === parts.includes('shift')
  );
}

/** 插件持久化数据结构 */
interface PluginData {
  settings: ReaderSettings;
  progress: Record<string, BookProgress>;
  bookSettings?: Record<string, BookSettings>;
  tagCatalog?: TagCatalog;
  authorTagOrder?: string[];
  readingStats?: unknown;
  bookWordCountCache?: Record<string, BookWordCountCacheEntry>;
  lastDataBackupAt?: number;
  knownBooks?: string[];
}

interface ReadingStatRecord {
  filePath: string;
  title: string;
  readingMs?: number;
  timestamp?: number;
}

type UnknownRecord = Record<string, unknown>;

interface AggregatedBookStats {
  groupKey: string;
  title: string;
  filePaths: string[];
  originalFilePath?: string;
  hasOriginalSource: boolean;
  hasOriginalTags: boolean;
  tags: BookTags;
  totalReadingMs: number;
  readingDates: string[];
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
      this.plugin.sortTagValues('authors', this.draft.authors),
      new Set(this.draft.authors),
      (tag) => this.toggleArrayTag('authors', tag),
      (value) => this.addCustomArrayTag('authors', value),
      {
        ariaLabel: '添加作者',
        placeholder: '输入作者',
        suggestions: this.plugin.getAuthorTagOptions(this.draft.authors),
        submitOnBlur: true,
      },
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
    inputOptions: CustomTagInputOptions = {},
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
    if (onAdd) this.renderCustomTagInput(section, onAdd, inputOptions);
  }

  private renderAccumulationTagSection(parent: HTMLElement, options: string[]): void {
    const selected = new Set(this.draft.accumulation.map((tag) => tag.name));
    const section = parent.createDiv({ cls: 'puffs-tag-section' });
    section.createDiv({ cls: 'puffs-tag-section-title', text: '积累' });
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

  private renderCustomTagInput(
    parent: HTMLElement,
    onAdd: (value: string) => void | Promise<void>,
    options: CustomTagInputOptions = {},
  ): void {
    const row = parent.createDiv({ cls: 'puffs-tag-custom-row' });
    const input = row.createEl('input', {
      cls: 'puffs-tag-custom-input',
      attr: {
        type: 'text',
        'aria-label': options.ariaLabel ?? '添加标签',
        ...(options.placeholder ? { placeholder: options.placeholder } : {}),
      },
    }) as HTMLInputElement;
    const submitValue = (rawValue: string) => {
      const value = rawValue.trim();
      if (!value) return;
      input.value = '';
      Promise.resolve(onAdd(value)).catch((error) => {
        console.error('[Puffs Reader] Failed to add tag:', error);
        new Notice('保存标签失败');
      });
    };
    const submit = () => submitValue(input.value);
    if (options.suggestions && options.suggestions.length > 0) {
      new TagInputSuggest(this.plugin.app, input, options.suggestions, submitValue);
    }
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    if (options.submitOnBlur) {
      input.addEventListener('blur', submit);
    }
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
      this.rerenderPreservingScroll();
      return;
    }
    if (startChapter !== undefined && endChapter !== undefined && endChapter < startChapter) {
      new Notice('结束章节不能小于起始章节');
      this.rerenderPreservingScroll();
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
    this.rerenderPreservingScroll();
  }

  private rerenderPreservingScroll(): void {
    const scrollTop = this.contentEl.querySelector<HTMLElement>('.puffs-tag-modal-body')?.scrollTop ?? 0;
    this.render();
    window.requestAnimationFrame(() => {
      const body = this.contentEl.querySelector<HTMLElement>('.puffs-tag-modal-body');
      if (body) body.scrollTop = scrollTop;
    });
  }
}

class GlobalTagCatalogModal extends Modal {
  private plugin: PuffsReaderPlugin;
  private onSaved: () => void;
  private draggingTag: { group: EditableGlobalTagGroup; value: string } | null = null;

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
    this.renderCatalogGroup(body, '积累', 'accumulation', catalog.accumulation);
    this.renderCatalogGroup(body, '作者', 'authors', this.plugin.getAuthorTagOptions(), false);
  }

  private renderCatalogGroup(
    parent: HTMLElement,
    title: string,
    group: EditableGlobalTagGroup,
    values: string[],
    allowAdd = true,
  ): void {
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
      const dragBtn = row.createEl('button', {
        cls: 'puffs-icon-btn puffs-catalog-btn puffs-catalog-drag',
        attr: {
          type: 'button',
          'aria-label': `调整${value}顺序`,
          draggable: 'true',
        },
      });
      setIcon(dragBtn, 'grip-vertical');
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
      removeBtn.addEventListener('click', () => {
        this.plugin.deleteTagCatalogItem(group, value)
          .then(() => this.afterSaved())
          .catch((error) => {
            console.error('[Puffs Reader] Failed to delete global tag:', error);
            new Notice('删除全局标签失败');
          });
      });
      dragBtn.addEventListener('dragstart', (event) => {
        this.draggingTag = { group, value };
        row.addClass('is-dragging');
        event.dataTransfer?.setData('text/plain', `${group}:${value}`);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      dragBtn.addEventListener('dragend', () => {
        this.draggingTag = null;
        row.removeClass('is-dragging');
      });
      row.addEventListener('dragover', (event) => {
        if (!this.draggingTag || this.draggingTag.group !== group || this.draggingTag.value === value) return;
        event.preventDefault();
        row.toggleClass('is-drag-over-after', this.isDropAfter(event, row));
        row.toggleClass('is-drag-over-before', !this.isDropAfter(event, row));
      });
      row.addEventListener('dragleave', () => {
        row.removeClass('is-drag-over-after');
        row.removeClass('is-drag-over-before');
      });
      row.addEventListener('drop', (event) => {
        if (!this.draggingTag || this.draggingTag.group !== group || this.draggingTag.value === value) return;
        event.preventDefault();
        const movingValue = this.draggingTag.value;
        const placement = this.isDropAfter(event, row) ? 'after' : 'before';
        this.draggingTag = null;
        this.plugin.reorderTagCatalogItem(group, movingValue, value, placement)
          .then(() => this.afterSaved())
          .catch((error) => {
            console.error('[Puffs Reader] Failed to reorder global tag:', error);
            new Notice('调整标签顺序失败');
          });
      });
    }
    if (allowAdd && group !== 'authors') this.renderAddRow(section, group);
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
    const scrollTop = this.contentEl.querySelector<HTMLElement>('.puffs-tag-modal-body')?.scrollTop ?? 0;
    this.onSaved();
    this.render();
    window.requestAnimationFrame(() => {
      const body = this.contentEl.querySelector<HTMLElement>('.puffs-tag-modal-body');
      if (body) body.scrollTop = scrollTop;
    });
  }

  private isDropAfter(event: DragEvent, row: HTMLElement): boolean {
    const rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }
}

class ReadingStatsView extends ItemView {
  private plugin: PuffsReaderPlugin;
  private selectedBookPath: string | null = null;
  private renderVersion = 0;
  private untaggedOnly = false;
  private bookSearchOpen = false;
  private bookSearchQuery = '';
  private bookSearchMode: BookSearchMode = 'title';
  private lastBookDetailPath: string | null = null;
  private globalBookSectionTitleEl: HTMLElement | null = null;
  private globalBookListEl: HTMLElement | null = null;
  private globalSummaryBookCountEl: HTMLElement | null = null;
  private globalSummaryReadingDaysEl: HTMLElement | null = null;
  private globalSummaryReadingTimeEl: HTMLElement | null = null;
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
    this.scope = new Scope(this.app.scope);
    this.scope.register(null, 'Escape', (event) => {
      if (document.body.querySelector('.modal-container')) return;
      event.preventDefault();
      event.stopPropagation();
      this.closeBookSearchOnEscape();
      return false;
    });
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
    const handleEscapeHotkey = (event: KeyboardEvent) => this.handleStatsEscapeHotkey(event);
    const handleBackHotkey = (event: KeyboardEvent) => this.handleBookDetailBackHotkey(event);
    const handleForwardHotkey = (event: KeyboardEvent) => this.handleBookDetailForwardHotkey(event);
    const handleSearchHotkey = (event: KeyboardEvent) => this.handleBookSearchHotkey(event);
    const handleSearchOutsideClick = (event: MouseEvent) => this.handleBookSearchOutsideClick(event);
    window.addEventListener('keydown', handleEscapeHotkey, true);
    document.addEventListener('keydown', handleEscapeHotkey, true);
    window.addEventListener('keydown', handleBackHotkey, true);
    document.addEventListener('keydown', handleBackHotkey, true);
    window.addEventListener('keydown', handleForwardHotkey, true);
    document.addEventListener('keydown', handleForwardHotkey, true);
    window.addEventListener('keydown', handleSearchHotkey, true);
    document.addEventListener('keydown', handleSearchHotkey, true);
    document.addEventListener('click', handleSearchOutsideClick, true);
    this.register(() => {
      window.removeEventListener('keydown', handleEscapeHotkey, true);
      document.removeEventListener('keydown', handleEscapeHotkey, true);
      window.removeEventListener('keydown', handleBackHotkey, true);
      document.removeEventListener('keydown', handleBackHotkey, true);
      window.removeEventListener('keydown', handleForwardHotkey, true);
      document.removeEventListener('keydown', handleForwardHotkey, true);
      window.removeEventListener('keydown', handleSearchHotkey, true);
      document.removeEventListener('keydown', handleSearchHotkey, true);
      document.removeEventListener('click', handleSearchOutsideClick, true);
    });
    this.render();
  }

  showGlobalDefault(): void {
    this.selectedBookPath = null;
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
    this.globalSummaryReadingDaysEl = null;
    this.globalSummaryReadingTimeEl = null;
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
    const totalReadingMs = state.books.reduce((sum, book) => sum + book.totalReadingMs, 0);
    const readingDays = new Set(state.books.flatMap((book) => book.readingDates)).size;

    this.renderHeader(parent, '阅读统计', false, (actions) => this.renderRefreshButton(actions));
    const summary = parent.createDiv({ cls: 'puffs-reading-stats-summary' });
    summary.addClass('is-global');
    this.globalSummaryBookCountEl = this.createSummaryItem(summary, '书籍数量', `${state.summaryBookCount} 本`);
    this.globalSummaryReadingDaysEl = this.createSummaryItem(summary, '阅读天数', `${readingDays} 天`);
    this.globalSummaryReadingTimeEl = this.createSummaryItem(summary, '阅读时长', this.formatCompactDuration(totalReadingMs));

    this.renderTagFilters(parent, state.filterOptionBooks);

    this.globalBookSectionTitleEl = this.createSectionTitle(parent, '书籍列表', (actions) => this.renderBookSearchActions(actions));
    this.globalBookListEl = parent.createDiv({ cls: 'puffs-reading-stats-list' });
    this.renderGlobalBookList(this.globalBookListEl, state);
  }

  private getGlobalBookListState(): {
    hasFilters: boolean;
    hasSearch: boolean;
    useFullLibrary: boolean;
    filterOptionBooks: AggregatedBookStats[];
    books: AggregatedBookStats[];
    summaryBookCount: number;
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
    const summaryBookCount = useFullLibrary ? books.length : filterOptionBooks.length;
    return { hasFilters, hasSearch, useFullLibrary, filterOptionBooks, books, summaryBookCount };
  }

  private refreshGlobalBookList(): void {
    const state = this.getGlobalBookListState();
    this.globalBookSectionTitleEl?.setText('书籍列表');
    this.globalSummaryBookCountEl?.setText(`${state.summaryBookCount} 本`);
    const totalReadingMs = state.books.reduce((sum, book) => sum + book.totalReadingMs, 0);
    this.globalSummaryReadingDaysEl?.setText(`${new Set(state.books.flatMap((book) => book.readingDates)).size} 天`);
    this.globalSummaryReadingTimeEl?.setText(this.formatCompactDuration(totalReadingMs));
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
          `阅读时长 ${this.formatCompactDuration(book.totalReadingMs)}`,
          `最近阅读 ${this.formatDateTime(book.lastReadAt)}`,
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
    const readingDays = book.readingDates.length;

    const summary = parent.createDiv({ cls: 'puffs-reading-stats-summary' });
    summary.addClass('is-detail');
    const totalWordsEl = this.createSummaryItem(summary, '书籍字数', '计算中…');
    this.createSummaryItem(summary, '阅读天数', `${readingDays} 天`);
    this.createSummaryItem(summary, '阅读时长', this.formatCompactDuration(book.totalReadingMs));
    const wordCountPath = [book.originalFilePath, ...book.filePaths]
      .filter((filePath): filePath is string => !!filePath)
      .find((filePath) => this.plugin.app.vault.getAbstractFileByPath(filePath) instanceof TFile);
    const renderVersion = this.renderVersion;
    if (wordCountPath) {
      this.plugin.getBookTotalWordCount(wordCountPath)
        .then((totalWords) => {
          if (renderVersion !== this.renderVersion || this.selectedBookPath !== book.groupKey || !totalWordsEl.isConnected) return;
          totalWordsEl.setText(this.formatCompactNumber(totalWords));
        })
        .catch((error) => {
          console.error('[Puffs Reader] Failed to load book word count:', error);
          if (renderVersion === this.renderVersion && totalWordsEl.isConnected) totalWordsEl.setText('—');
        });
    } else {
      totalWordsEl.setText('—');
    }

    this.createSectionTitle(parent, '相关标签', (actions) => {
      this.renderEditBookTagsButton(actions, book);
    });
    this.renderReadonlyTagRows(parent, book.tags);
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

  private handleStatsEscapeHotkey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (!this.isActiveStatsView()) return;
    if (document.body.querySelector('.modal-container')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.closeBookSearchOnEscape();
  }

  private closeBookSearchOnEscape(): void {
    if (this.bookSearchOpen && !this.selectedBookPath) {
      this.clearBookSearch();
      this.render();
    }
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
    const isTitleSearch = matchesHotkey(event, this.plugin.settings.bookshelfTitleSearchHotkey || DEFAULT_SETTINGS.bookshelfTitleSearchHotkey);
    const isAuthorSearch = matchesHotkey(event, this.plugin.settings.bookshelfAuthorSearchHotkey || DEFAULT_SETTINGS.bookshelfAuthorSearchHotkey);
    if (!isTitleSearch && !isAuthorSearch) return;
    if (this.selectedBookPath) return;
    if (!this.isActiveStatsView()) return;
    event.preventDefault();
    event.stopPropagation();
    if (isAuthorSearch) this.toggleAuthorBookSearch();
    else this.toggleTitleBookSearch();
  }

  private handleBookSearchOutsideClick(event: MouseEvent): void {
    if (!this.bookSearchOpen || this.selectedBookPath) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    const searchActions = this.contentEl.querySelector('.puffs-reading-stats-book-search-actions');
    if (searchActions?.contains(target)) return;
    window.setTimeout(() => {
      if (!this.bookSearchOpen || this.selectedBookPath) return;
      this.clearBookSearch();
      this.render();
    }, 0);
  }

  private isActiveStatsView(): boolean {
    return this.app.workspace.getActiveViewOfType(ReadingStatsView) === this
      || !!this.contentEl.closest('.workspace-leaf.mod-active')
      || this.contentEl.contains(document.activeElement);
  }

  private goBackToGlobal(): void {
    this.selectedBookPath = null;
    this.render();
  }

  private createSummaryItem(
    parent: HTMLElement,
    label: string,
    value: string,
  ): HTMLElement {
    const item = parent.createDiv({ cls: 'puffs-reading-stats-summary-item' });
    item.createDiv({ cls: 'puffs-reading-stats-summary-label', text: label });
    const valueEl = item.createDiv({ cls: 'puffs-reading-stats-summary-value', text: value });
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
    parent.addClass('puffs-reading-stats-book-search-actions');
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
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.clearBookSearch();
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
        this.bookSearchQuery = '';
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
      this.render();
    });
  }

  private clearBookSearch(): void {
    this.bookSearchQuery = '';
    this.bookSearchOpen = false;
  }

  private toggleTitleBookSearch(): void {
    if (this.bookSearchOpen && this.bookSearchMode === 'title') {
      this.clearBookSearch();
      this.render();
      return;
    }
    this.bookSearchMode = 'title';
    this.bookSearchOpen = true;
    this.bookSearchQuery = '';
    this.render();
  }

  private toggleAuthorBookSearch(): void {
    if (this.bookSearchMode === 'author') {
      this.bookSearchMode = 'title';
      this.clearBookSearch();
      this.render();
      return;
    }
    this.bookSearchMode = 'author';
    this.bookSearchOpen = true;
    this.bookSearchQuery = '';
    this.render();
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

    this.createSectionTitle(parent, '标签筛选', (titleActions) => {
      titleActions.addClass('puffs-reading-stats-filter-title-actions');
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
    });

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
    this.renderTagFilterGroup(panel, '积累', 'accumulation', options.accumulation);
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
      genre: this.plugin.sortTagValues('genre', uniqueNormalizedTags([...catalog.genre, ...books.flatMap((book) => book.tags.genre)])),
      serialStatus: uniqueNormalizedTags([...catalog.status, ...books.map((book) => book.tags.serialStatus ?? '')]),
      readingStatus: uniqueNormalizedTags([
        ...READING_STATUS_OPTIONS,
        ...books.map((book) => book.tags.readingStatus || DEFAULT_READING_STATUS),
      ]),
      feature: this.plugin.sortTagValues('feature', uniqueNormalizedTags([...catalog.feature, ...books.flatMap((book) => book.tags.feature)])),
      accumulation: this.plugin.sortTagValues('accumulation', uniqueNormalizedTags([
        ...catalog.accumulation,
        ...books.flatMap((book) => book.tags.accumulation.map((tag) => tag.name)),
      ])),
    };
  }

  private toggleTagFilter(group: ReadingStatsTagFilterGroup, value: string): void {
    this.untaggedOnly = false;
    const filters = this.tagFilters[group];
    if (filters.has(value)) filters.delete(value);
    else filters.add(value);
  }

  private clearTagFilters(): void {
    for (const filters of Object.values(this.tagFilters)) filters.clear();
    this.untaggedOnly = false;
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
      { group: 'authors' as const, label: '作者', labels: this.plugin.sortTagValues('authors', normalized.authors) },
      { group: 'genre' as const, label: '题材', labels: this.plugin.sortTagValues('genre', normalized.genre) },
      { group: 'serialStatus' as const, label: '状态', labels: normalized.serialStatus ? [normalized.serialStatus] : [] },
      { group: 'readingStatus' as const, label: '阅读', labels: [normalized.readingStatus || DEFAULT_READING_STATUS] },
      { group: 'feature' as const, label: '特色', labels: this.plugin.sortTagValues('feature', normalized.feature) },
      {
        group: 'accumulation' as const,
        label: '积累',
        labels: this.plugin.sortAccumulationTags(normalized.accumulation).map((tag) => formatAccumulationTagLabel(tag)),
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
          readingDates: [],
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
      group.readingDates = [...new Set([...group.readingDates, ...book.readingDates])].sort();
      group.lastReadAt = Math.max(group.lastReadAt, book.lastReadAt);
    }
    if (includeLibraryBooks) {
      for (const file of this.plugin.getSelectableBookFiles()) {
        const groupKey = getReadingStatsGroupKey(file.path, file.basename);
        const isSummary = isSummaryReadingStatsBook(file.path, file.basename);
        const fileTags = this.plugin.getBookTags(file.path);
        const fileHasTags = hasAnyBookTags(fileTags);
        const group = groups.get(groupKey);
        if (group) {
          if (!isSummary && !group.originalFilePath) group.originalFilePath = file.path;
          if (!isSummary && !group.hasOriginalSource) {
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
          originalFilePath: isSummary ? undefined : file.path,
          hasOriginalSource: !isSummary,
          hasOriginalTags: fileHasTags,
          tags: fileTags,
          totalReadingMs: 0,
          readingDates: [],
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
                this.render();
              })
              .catch((error) => console.error('[Puffs Reader] Failed to delete book reading stats:', error));
          });
      });
      menu.showAtMouseEvent(event);
    });
  }

  private formatCompactDuration(ms: number): string {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 10) return `${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${totalMinutes}min`;
  }

  private formatCompactNumber(value: number): string {
    const n = Math.max(0, Math.round(value));
    if (n < 10000) return String(n);
    if (n >= 100000) return `${Math.floor(n / 10000)}W`;
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

}

// ═══════════════════════════════════════════════════════════════════════
//  插件主类
// ═══════════════════════════════════════════════════════════════════════

export default class PuffsReaderPlugin extends Plugin {
  settings: ReaderSettings = DEFAULT_SETTINGS;
  progress: Record<string, BookProgress> = {};
  bookSettings: Record<string, BookSettings> = {};
  tagCatalog: TagCatalog = normalizeTagCatalog(undefined);
  authorTagOrder: string[] = [];
  readingStats: ReadingStatsData = { schemaVersion: 3, books: {} };
  bookWordCountCache: Record<string, BookWordCountCacheEntry> = {};
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
    const existing = this.findOpenReaderLeaf(file.path);
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) {
      await leaf.setViewState({
        type: READER_VIEW_TYPE,
        state: { file: file.path },
      });
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (view instanceof ReaderView) {
      view.focusReader();
    }
  }

  private findOpenReaderLeaf(filePath: string): WorkspaceLeaf | null {
    for (const leaf of this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)) {
      const state = leaf.view instanceof ReaderView
        ? leaf.view.getState()
        : leaf.getViewState().state as Record<string, unknown> | null;
      if (state?.file === filePath) return leaf;
    }
    return null;
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
    const loadedSettings = Object.assign({}, DEFAULT_SETTINGS, data?.settings) as ReaderSettings & {
      readingStatsMinPageMs?: unknown;
    };
    const hadLegacyReadingPageSetting = Object.prototype.hasOwnProperty.call(loadedSettings, 'readingStatsMinPageMs');
    delete loadedSettings.readingStatsMinPageMs;
    this.settings = loadedSettings;
    if (this.settings.tocRegex === LEGACY_DEFAULT_TOC_REGEX || this.settings.tocRegex === LEGACY_PROLOGUE_TOC_REGEX) {
      this.settings.tocRegex = DEFAULT_SETTINGS.tocRegex;
    }
    if (
      this.settings.chapterTitleRegex === LEGACY_DEFAULT_CHAPTER_TITLE_REGEX ||
      this.settings.chapterTitleRegex === LEGACY_PROLOGUE_CHAPTER_TITLE_REGEX
    ) {
      this.settings.chapterTitleRegex = DEFAULT_SETTINGS.chapterTitleRegex;
    }
    this.progress = data?.progress ?? {};
    this.bookSettings = data?.bookSettings ?? {};
    this.tagCatalog = normalizeTagCatalog(data?.tagCatalog);
    this.authorTagOrder = this.normalizeAuthorTagOrder(data?.authorTagOrder);
    const rawReadingStats = this.asRecord(data?.readingStats);
    const needsReadingStatsMigration = Object.keys(rawReadingStats).length > 0
      && Number(rawReadingStats.schemaVersion) !== 3;
    this.readingStats = this.normalizeReadingStats(data?.readingStats);
    this.bookWordCountCache = this.normalizeBookWordCountCache(data?.bookWordCountCache);
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
    if (needsReadingStatsMigration || hadLegacyReadingPageSetting) {
      await this.backupDataJson();
      await this.writePluginData();
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
      authorTagOrder: this.authorTagOrder,
      readingStats: this.readingStats,
      bookWordCountCache: this.bookWordCountCache,
      lastDataBackupAt: this.lastDataBackupAt,
      knownBooks: this.knownBooks,
    } as PluginData);
  }

  private normalizeReadingStats(input: unknown): ReadingStatsData {
    const raw = this.asRecord(input);
    const schemaVersion = Number(raw.schemaVersion);
    const books: ReadingStatsData['books'] = {};
    for (const [filePath, value] of Object.entries(this.asRecord(raw.books))) {
      const book = this.asRecord(value);
      const readingDates = schemaVersion === 3
        ? this.normalizeReadingDates(book.readingDates)
        : this.normalizeReadingDates(
          Object.entries(this.asRecord(book.daily))
            .filter(([, item]) => {
              const daily = this.asRecord(item);
              return this.safeNonNegativeNumber(daily.readingMs) > 0
                || this.safeNonNegativeNumber(daily.readWords) > 0;
            })
            .map(([date]) => date),
        );
      books[filePath] = {
        title: typeof book.title === 'string' && book.title.trim()
          ? book.title
          : filePath.split('/').pop()?.replace(/\.txt$/i, '') || filePath,
        totalReadingMs: this.safeNonNegativeNumber(book.totalReadingMs),
        readingDates,
        lastReadAt: this.safeNonNegativeNumber(book.lastReadAt),
      };
    }
    return { schemaVersion: 3, books };
  }

  private normalizeReadingDates(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(
      (date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date),
    ))].sort();
  }

  private normalizeBookWordCountCache(input: unknown): Record<string, BookWordCountCacheEntry> {
    const result: Record<string, BookWordCountCacheEntry> = {};
    for (const [filePath, value] of Object.entries(this.asRecord(input))) {
      const item = this.asRecord(value);
      const mtime = this.safeNonNegativeNumber(item.mtime);
      const encodingKey = typeof item.encodingKey === 'string' ? item.encodingKey.trim() : '';
      const totalWords = Number(item.totalWords);
      if (mtime <= 0 || !encodingKey || !Number.isFinite(totalWords) || totalWords < 0) continue;
      result[filePath] = {
        mtime,
        encodingKey,
        totalWords: Math.floor(totalWords),
      };
    }
    return result;
  }

  private safeNonNegativeNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private asRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as UnknownRecord
      : {};
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

  async getBookTotalWordCount(filePath: string): Promise<number> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) throw new Error(`Book file not found: ${filePath}`);
    const encodingKey = this.getBookWordCountEncodingKey(filePath);
    const cached = this.bookWordCountCache[filePath];
    if (cached?.mtime === file.stat.mtime && cached.encodingKey === encodingKey) {
      return cached.totalWords;
    }

    const buffer = await this.app.vault.readBinary(file);
    const forcedEncoding = this.bookSettings[filePath]?.encoding ?? this.progress[filePath]?.encoding;
    const decoded = decodeTxtBuffer(buffer, forcedEncoding, this.settings.defaultEncoding);
    return this.cacheBookWordCountFromText(file, decoded.text);
  }

  async cacheBookWordCountFromText(file: TFile, text: string): Promise<number> {
    const totalWords = text.replace(/\s/g, '').length;
    const next: BookWordCountCacheEntry = {
      mtime: file.stat.mtime,
      encodingKey: this.getBookWordCountEncodingKey(file.path),
      totalWords,
    };
    const current = this.bookWordCountCache[file.path];
    if (
      current?.mtime === next.mtime
      && current.encodingKey === next.encodingKey
      && current.totalWords === next.totalWords
    ) {
      return totalWords;
    }
    this.bookWordCountCache[file.path] = next;
    await this.savePluginData();
    return totalWords;
  }

  private getBookWordCountEncodingKey(filePath: string): string {
    const forcedEncoding = this.bookSettings[filePath]?.encoding ?? this.progress[filePath]?.encoding;
    return forcedEncoding
      ? `forced:${forcedEncoding.trim().toLowerCase()}`
      : `auto:${this.settings.defaultEncoding.trim().toLowerCase()}`;
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

  async deleteBookReadingStats(filePath: string): Promise<void> {
    if (!this.deleteBookReadingStatsInMemory(filePath)) return;
    await this.savePluginData();
  }

  private deleteBookReadingStatsInMemory(filePath: string): boolean {
    const book = this.readingStats.books[filePath];
    if (!book) return false;
    delete this.readingStats.books[filePath];
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
    if (readingMs <= 0) return;

    const existing = this.readingStats.books[record.filePath];
    const dayKey = this.getLocalDateKey(timestamp);
    const book = existing ?? {
      title: record.title,
      totalReadingMs: 0,
      readingDates: [],
      lastReadAt: 0,
    };
    book.title = record.title || book.title;
    book.totalReadingMs += readingMs;
    book.readingDates = this.normalizeReadingDates([...book.readingDates, dayKey]);
    book.lastReadAt = Math.max(book.lastReadAt, timestamp);
    this.readingStats.books[record.filePath] = book;
    await this.savePluginData();
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

  getBookTags(filePath: string): BookTags {
    return normalizeBookTags(this.bookSettings[filePath]?.tags);
  }

  getTagCatalog(): TagCatalog {
    return normalizeTagCatalog(this.tagCatalog);
  }

  getAuthorTagOptions(extra: string[] = []): string[] {
    const currentAuthors = uniqueNormalizedTags([
      ...Object.values(this.bookSettings).flatMap((settings) => normalizeBookTags(settings.tags).authors),
      ...extra,
    ]);
    return this.sortValuesByOrder(currentAuthors, this.authorTagOrder);
  }

  sortTagValues(group: EditableGlobalTagGroup, values: string[]): string[] {
    const order = group === 'authors' ? this.authorTagOrder : this.getTagCatalog()[group];
    return this.sortValuesByOrder(values, order);
  }

  sortAccumulationTags(tags: BookTags['accumulation']): BookTags['accumulation'] {
    const names = this.sortTagValues('accumulation', tags.map((tag) => tag.name));
    return names
      .map((name) => tags.find((tag) => tag.name === name))
      .filter((tag): tag is BookTags['accumulation'][number] => !!tag);
  }

  async reorderTagCatalogItem(
    group: EditableGlobalTagGroup,
    movingRawValue: string,
    targetRawValue: string,
    placement: 'before' | 'after',
  ): Promise<void> {
    const movingValue = this.normalizeCatalogValue(group, movingRawValue);
    const targetValue = this.normalizeCatalogValue(group, targetRawValue);
    if (!movingValue || !targetValue || movingValue === targetValue) return;

    if (group === 'authors') {
      this.authorTagOrder = this.reorderValues(this.getAuthorTagOptions(), movingValue, targetValue, placement);
      await this.savePluginData();
      return;
    }

    const nextCatalog = normalizeTagCatalog(this.tagCatalog);
    nextCatalog[group] = this.reorderValues(nextCatalog[group], movingValue, targetValue, placement);
    this.tagCatalog = nextCatalog;
    await this.savePluginData();
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

  async renameTagCatalogItem(group: EditableGlobalTagGroup, oldRawValue: string, newRawValue: string): Promise<void> {
    const oldValue = this.normalizeCatalogValue(group, oldRawValue);
    const newValue = this.normalizeCatalogValue(group, newRawValue);
    if (!oldValue || !newValue || oldValue === newValue) return;

    if (group !== 'authors') {
      const nextCatalog = normalizeTagCatalog(this.tagCatalog);
      nextCatalog[group] = uniqueNormalizedTags(nextCatalog[group].map((value) => value === oldValue ? newValue : value));
      this.tagCatalog = nextCatalog;
    } else {
      this.authorTagOrder = uniqueNormalizedTags(this.authorTagOrder.map((value) => value === oldValue ? newValue : value));
    }

    for (const [filePath, settings] of Object.entries(this.bookSettings)) {
      const tags = normalizeBookTags(settings.tags);
      const nextTags = this.renameBookTag(tags, group, oldValue, newValue);
      if (nextTags === tags) continue;
      this.bookSettings[filePath] = { ...settings, tags: nextTags };
    }
    await this.savePluginData();
  }

  async deleteTagCatalogItem(group: EditableGlobalTagGroup, rawValue: string): Promise<void> {
    const value = this.normalizeCatalogValue(group, rawValue);
    if (!value) return;

    if (group !== 'authors') {
      const nextCatalog = normalizeTagCatalog(this.tagCatalog);
      nextCatalog[group] = nextCatalog[group].filter((item) => item !== value);
      this.tagCatalog = nextCatalog;
    } else {
      this.authorTagOrder = this.authorTagOrder.filter((item) => item !== value);
    }

    for (const [filePath, settings] of Object.entries(this.bookSettings)) {
      const tags = normalizeBookTags(settings.tags);
      const nextTags = this.deleteBookTag(tags, group, value);
      if (nextTags === tags) continue;
      this.bookSettings[filePath] = { ...settings, tags: nextTags };
    }
    await this.savePluginData();
  }

  private normalizeCatalogValue(group: EditableGlobalTagGroup, rawValue: string): string {
    return group === 'accumulation' ? normalizeAccumulationTagName(rawValue) : normalizeTagName(rawValue);
  }

  private renameBookTag(tags: BookTags, group: EditableGlobalTagGroup, oldValue: string, newValue: string): BookTags {
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

  private deleteBookTag(tags: BookTags, group: EditableGlobalTagGroup, value: string): BookTags {
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
      this.authorTagOrder = this.sortValuesByOrder(uniqueNormalizedTags([
        ...this.authorTagOrder,
        ...tags.authors,
      ]), this.authorTagOrder);
    }
    this.bookSettings[filePath] = compact;
    await this.savePluginData();
  }

  private normalizeAuthorTagOrder(input: unknown): string[] {
    const saved = Array.isArray(input) ? input : [];
    const discovered = Object.values(this.bookSettings).flatMap((settings) => normalizeBookTags(settings.tags).authors);
    return this.sortValuesByOrder(uniqueNormalizedTags([...saved, ...discovered]), uniqueNormalizedTags(saved));
  }

  private sortValuesByOrder(values: string[], order: string[]): string[] {
    const normalizedValues = uniqueNormalizedTags(values);
    const remaining = new Set(normalizedValues);
    const result: string[] = [];
    for (const orderedValue of uniqueNormalizedTags(order)) {
      if (!remaining.has(orderedValue)) continue;
      result.push(orderedValue);
      remaining.delete(orderedValue);
    }
    for (const value of normalizedValues) {
      if (!remaining.has(value)) continue;
      result.push(value);
      remaining.delete(value);
    }
    return result;
  }

  private reorderValues(values: string[], movingValue: string, targetValue: string, placement: 'before' | 'after'): string[] {
    const next = uniqueNormalizedTags(values).filter((value) => value !== movingValue);
    const targetIndex = next.indexOf(targetValue);
    if (targetIndex < 0) return uniqueNormalizedTags(values);
    next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, movingValue);
    return next;
  }
}
