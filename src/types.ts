/** 阅读器全局设置 */
export interface ReaderSettings {
  /** 正文字体大小 (px) */
  fontSize: number;
  /** 正文行间距 (倍数) */
  lineHeight: number;
  /** 段落间距 (px) */
  paragraphSpacing: number;
  /** 全局首行缩进 (em)，单书设置可以覆写 */
  firstLineIndent: number;
  /** 阅读区宽度 (px) */
  contentWidth: number;
  /** 字间距 (px) */
  letterSpacing: number;
  /** 正文内容与页面顶部的距离 (px) */
  paddingTop: number;
  /** 正文内容与页面底部的距离 (px) */
  paddingBottom: number;
  /** 正文字体颜色 (RGB, e.g. "51,51,51"，空字符串跟随主题) */
  fontColor: string;
  /** 书籍背景颜色 (RGB, e.g. "233,216,188"，空字符串跟随主题) */
  backgroundColor: string;
  /** 顶部章名字号 (px) */
  chapterMetaFontSize: number;
  /** 顶部章名颜色 (RGB，空字符串跟随主题 muted 色) */
  chapterMetaColor: string;
  /** 顶部章名距离页面顶部的位置 (px) */
  chapterMetaTop: number;
  /** 底部百分比字号 (px) */
  progressMetaFontSize: number;
  /** 底部百分比颜色 (RGB，空字符串跟随主题 muted 色) */
  progressMetaColor: string;
  /** 底部百分比距离页面底部的位置 (px) */
  progressMetaBottom: number;
  /** 左侧栏宽度 (px) */
  sidebarWidth: number;
  /** 左侧栏展开/收起过渡时长 (ms) */
  sidebarTransitionMs: number;
  /** 目录字体大小 (px) */
  tocFontSize: number;
  /** 是否显示阅读进度百分比 */
  showProgress: boolean;
  /** 是否显示顶部章名 */
  showChapterTitle: boolean;
  /** 是否去除多余空行 */
  removeExtraBlankLines: boolean;
  /** 阅读器激活时鼠标静止多久后隐藏光标 (ms)，0 表示不隐藏 */
  cursorHideDelayMs: number;
  /** Keyboard arrow manual page turn limit (pages per second). */
  manualPageTurnsPerSecond: number;
  /** Extra hotkey for previous page. */
  previousPageHotkey: string;
  /** Extra hotkey for next page. */
  nextPageHotkey: string;
  /** 全局目录匹配正则，单书设置可以覆写 */
  tocRegex: string;
  /** 全局章名提取正则，单书设置可以覆写 */
  chapterTitleRegex: string;
  /** 全局序章类标题匹配正则，单书设置可以覆写 */
  prologueTitleRegex: string;
  /** 默认编码 */
  defaultEncoding: string;
  /** 全文搜索快捷键 */
  searchHotkey: string;
  /** 目录侧边栏切换快捷键 */
  tocPanelHotkey: string;
  /** 拆分文本快捷键 */
  copySourceHotkey: string;
  /** 按章节拆分原文的导出目录（vault 内相对路径） */
  breakdownTextDir: string;
  /** 侧边栏顶部书名字号 (px) */
  sidebarTitleFontSize: number;
  /** 标注高亮背景色 (RGB)，空 = 跟随浏览器选区色 */
  annotationHighlightColor: string;
  /** 标注/批注导出目录（vault 内相对路径，留空 = 根目录） */
  annotationExportDir: string;
  /** 导出 Markdown 成功后是否删除当前书对应的标注/批注 */
  deleteAnnotationsAfterExport: boolean;
  /** data.json 备份路径；留空则备份到插件目录 data.backup.json */
  dataBackupPath: string;
  /** data.json 自动备份频率（小时） */
  dataBackupFrequencyHours: number;
  /** 书库 Git 同步：书库目录路径（绝对路径或相对于 vault 的路径），留空禁用 */
  bookLibraryPath: string;
  /** 页面停留多久后计入已读字数和章节 (ms) */
  readingStatsMinPageMs: number;
  /** 单页停留超过多久后停止继续累计阅读时长 (ms) */
  readingStatsIdleLimitMs: number;
}

/** 一条标注或批注 */
export interface Annotation {
  /** 起始段落索引 */
  paraIndex: number;
  /** 段内起始字符偏移 */
  startOffset: number;
  /** 选中文本长度（字符数） */
  length: number;
  /** 跨段标注的结束段落索引；旧数据或单段标注为空 */
  endParaIndex?: number;
  /** 跨段标注的结束段内字符偏移；旧数据或单段标注为空 */
  endOffset?: number;
  /** 选中的原文（冗余存储，便于导出且抗源文件变化） */
  text: string;
  /** 批注文字；undefined 表示纯标注 */
  note?: string;
  /** 创建时间戳 */
  createdAt: number;
}

/** 每本书的专用设置；undefined 表示回退全局设置 */
export interface BookSettings {
  /** 当前书的编码覆写 */
  encoding?: string;
  /** 当前书的首行缩进覆写 (em) */
  firstLineIndent?: number;
  /** 当前书的目录匹配正则覆写 */
  tocRegex?: string;
  /** 当前书的章名提取正则覆写 */
  chapterTitleRegex?: string;
  /** 当前书的序章类标题匹配正则覆写 */
  prologueTitleRegex?: string;
  /** Whether the current book uses nested TOC indentation. */
  tocIndentEnabled?: boolean;
  /** Regex for the level-1 chapter marker, e.g. "卷" or "部". */
  tocIndentLevel1Regex?: string;
  /** Regex for the level-2 chapter marker, e.g. "章". */
  tocIndentLevel2Regex?: string;
  /** Regex for the level-3 chapter marker, e.g. "节". */
  tocIndentLevel3Regex?: string;
  /** 当前书的标注/批注列表 */
  annotations?: Annotation[];
}

/** 每本书的阅读进度 */
export interface BookProgress {
  /** 上次阅读的段落索引 */
  paragraphIndex: number;
  /** 上次阅读的段内字符偏移，用于页模式精确恢复 */
  charOffset?: number;
  /** 上次阅读时间戳 */
  lastRead: number;
  /** 兼容旧数据：旧版本把编码覆写存放在 progress 中 */
  encoding?: string;
}

/** 已计入阅读统计的全书字符区间，半开区间 [start, end) */
export interface CountedRange {
  start: number;
  end: number;
}

/** 已阅读章节区间，索引为解析后的目录索引，end 为闭区间 */
export interface ReadChapterRange {
  start: number;
  end: number;
  startTitle: string;
  endTitle: string;
}

/** 单本书阅读统计 */
export interface BookReadingStats {
  title: string;
  totalReadingMs: number;
  totalReadWords: number;
  countedRanges: CountedRange[];
  readChapterRanges: ReadChapterRange[];
  daily: Record<string, BookDailyReadingStats>;
  lastReadAt: number;
}

/** 单本书单日阅读统计 */
export interface BookDailyReadingStats {
  readingMs: number;
  readWords: number;
  readChapterRanges: ReadChapterRange[];
}

/** 单日阅读统计 */
export interface DailyReadingStats {
  readingMs: number;
  readWords: number;
  bookPaths: string[];
}

/** 阅读统计持久化数据 */
export interface ReadingStatsData {
  schemaVersion: 2;
  books: Record<string, BookReadingStats>;
  daily: Record<string, DailyReadingStats>;
}

/** 解析出的章节 */
export interface Chapter {
  /** 展示用章节标题 */
  title: string;
  /** 原始章节行 */
  rawTitle: string;
  /** 起始段落索引 */
  startParaIndex: number;
  /** 层级 (1=卷, 2=章, 3=节) */
  level: number;
}

/** 搜索结果 */
export interface SearchMatch {
  /** 所在段落索引 */
  paraIndex: number;
  /** 在段落文本中的起始偏移 */
  startOffset: number;
  /** 匹配长度 */
  length: number;
}

/** 支持的编码列表 */
export const SUPPORTED_ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' },
  { value: 'big5', label: 'Big5' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'shift_jis', label: 'Shift_JIS' },
  { value: 'euc-kr', label: 'EUC-KR' },
];

export const DEFAULT_TOC_REGEX = '^\\s*第[零〇一二三四五六七八九十百千万亿两\\d]+[章节回卷集部篇].*$';
export const DEFAULT_CHAPTER_TITLE_REGEX = '^\\s*第([零〇一二三四五六七八九十百千万亿两\\d]+)([章节回卷集部篇])\\s*(.*)$';
export const DEFAULT_PROLOGUE_TITLE_REGEX = '^\\s*(?:序章|前言|楔子|引子)(?:\\s+.*)?$';

/** 默认设置 */
export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  paragraphSpacing: 10,
  firstLineIndent: 2,
  contentWidth: 800,
  letterSpacing: 0,
  paddingTop: 40,
  paddingBottom: 40,
  fontColor: '',
  backgroundColor: '',
  chapterMetaFontSize: 12,
  chapterMetaColor: '',
  chapterMetaTop: 10,
  progressMetaFontSize: 12,
  progressMetaColor: '',
  progressMetaBottom: 10,
  sidebarWidth: 272,
  sidebarTransitionMs: 180,
  tocFontSize: 13,
  showProgress: true,
  showChapterTitle: true,
  removeExtraBlankLines: true,
  cursorHideDelayMs: 2000,
  manualPageTurnsPerSecond: 4,
  previousPageHotkey: 'j',
  nextPageHotkey: 'l',
  tocRegex: DEFAULT_TOC_REGEX,
  chapterTitleRegex: DEFAULT_CHAPTER_TITLE_REGEX,
  prologueTitleRegex: DEFAULT_PROLOGUE_TITLE_REGEX,
  defaultEncoding: 'utf-8',
  searchHotkey: 'Ctrl+F',
  tocPanelHotkey: 'Ctrl+B',
  copySourceHotkey: 'Ctrl+Shift+C',
  breakdownTextDir: '拆书文本',
  sidebarTitleFontSize: 16,
  annotationHighlightColor: '',
  annotationExportDir: '',
  deleteAnnotationsAfterExport: true,
  dataBackupPath: '',
  dataBackupFrequencyHours: 24,
  bookLibraryPath: '',
  readingStatsMinPageMs: 100,
  readingStatsIdleLimitMs: 120000,
};
