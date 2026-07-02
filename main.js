var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PuffsReaderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");
var import_fs = require("fs");
var import_child_process = require("child_process");
var import_util = require("util");
var import_path = require("path");

// src/ReaderView.ts
var import_obsidian = require("obsidian");

// src/types.ts
var SUPPORTED_ENCODINGS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "gbk", label: "GBK" },
  { value: "gb18030", label: "GB18030" },
  { value: "big5", label: "Big5" },
  { value: "utf-16le", label: "UTF-16 LE" },
  { value: "utf-16be", label: "UTF-16 BE" },
  { value: "shift_jis", label: "Shift_JIS" },
  { value: "euc-kr", label: "EUC-KR" }
];
var DEFAULT_TOC_REGEX = "^\\s*\u7B2C[\u96F6\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\u4E24\\d]+[\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7].*$";
var DEFAULT_CHAPTER_TITLE_REGEX = "^\\s*\u7B2C([\u96F6\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\u4E24\\d]+)([\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7])\\s*(.*)$";
var DEFAULT_PROLOGUE_TITLE_REGEX = "^\\s*(?:\u5E8F\u7AE0|\u524D\u8A00|\u6954\u5B50|\u5F15\u5B50)(?:\\s+.*)?$";
var DEFAULT_TAG_CATALOG = {
  genre: ["\u7384\u5E7B", "\u4ED9\u4FA0", "\u5386\u53F2", "\u90FD\u5E02", "\u8BF8\u5929"],
  status: ["\u8FDE\u8F7D", "\u5B8C\u7ED3"],
  feature: ["\u6587\u91C7", "\u7B11\u70B9", "\u60C5\u8282", "\u67B6\u6784", "\u4EBA\u7269", "\u611F\u60C5", "\u8C0B\u7565", "\u8BBE\u5B9A"]
};
var DEFAULT_SETTINGS = {
  fontSize: 18,
  lineHeight: 1.8,
  paragraphSpacing: 10,
  firstLineIndent: 2,
  contentWidth: 800,
  letterSpacing: 0,
  paddingTop: 40,
  paddingBottom: 40,
  fontColor: "",
  backgroundColor: "",
  chapterMetaFontSize: 12,
  chapterMetaColor: "",
  chapterMetaTop: 10,
  progressMetaFontSize: 12,
  progressMetaColor: "",
  progressMetaBottom: 10,
  sidebarWidth: 272,
  sidebarTransitionMs: 180,
  tocFontSize: 13,
  showProgress: true,
  showChapterTitle: true,
  removeExtraBlankLines: true,
  cursorHideDelayMs: 2e3,
  manualPageTurnsPerSecond: 4,
  previousPageHotkey: "j",
  nextPageHotkey: "l",
  tocRegex: DEFAULT_TOC_REGEX,
  chapterTitleRegex: DEFAULT_CHAPTER_TITLE_REGEX,
  prologueTitleRegex: DEFAULT_PROLOGUE_TITLE_REGEX,
  defaultEncoding: "utf-8",
  searchHotkey: "Ctrl+F",
  tocPanelHotkey: "Ctrl+B",
  copySourceHotkey: "Ctrl+Shift+C",
  breakdownTextDir: "\u62C6\u4E66\u6587\u672C",
  sidebarTitleFontSize: 16,
  annotationHighlightColor: "",
  annotationExportDir: "",
  deleteAnnotationsAfterExport: true,
  dataBackupPath: "",
  dataBackupFrequencyHours: 24,
  bookLibraryPath: "",
  readingStatsMinPageMs: 100,
  readingStatsIdleLimitMs: 12e4
};

// src/ReaderView.ts
var READER_VIEW_TYPE = "puffs-reader-view";
var DEFAULT_READING_STATS_PAGE_MIN_MS = 100;
var DEFAULT_READING_STATS_IDLE_LIMIT_MS = 2 * 60 * 1e3;
var ReaderView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.filePath = "";
    this.currentFile = null;
    this.fileBuffer = null;
    this.currentEncoding = "utf-8";
    this.paragraphs = [];
    this.paragraphStartOffsets = [0];
    this.chapters = [];
    this.collapsedTocGroups = /* @__PURE__ */ new Set();
    this.searchQuery = "";
    this.searchResults = [];
    this.currentPageStart = { paraIndex: 0, charOffset: 0 };
    this.currentPageEnd = { paraIndex: 0, charOffset: 0 };
    this.pageBackStack = [];
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.isTocOpen = false;
    this.sidebarMode = "toc";
    this.isTypographyOpen = false;
    this.isRenderingPage = false;
    this.progressSaveTimer = 0;
    this.readingStatsTimer = 0;
    this.readingStatsPageKey = "";
    this.readingStatsLastTurnAt = 0;
    this.searchTimer = 0;
    this.cursorHideTimer = 0;
    this.lastManualPageTurnAt = 0;
    this.resizeObserver = null;
    this.boundGlobalKeydown = null;
    this.boundMouseMove = null;
    this.chapterCopyModal = null;
    this.spaceHoldTimer = 0;
    this.spaceHoldFired = false;
    this.spacePressedSelection = null;
    this.plugin = plugin;
    this.scope = new import_obsidian.Scope(this.app.scope);
    this.scope.register(null, "Escape", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      return false;
    });
  }
  getViewType() {
    return READER_VIEW_TYPE;
  }
  getDisplayText() {
    var _a, _b;
    return (_b = (_a = this.currentFile) == null ? void 0 : _a.basename) != null ? _b : "Puffs Reader";
  }
  getIcon() {
    return "book-open";
  }
  async onOpen() {
    this.buildUI();
  }
  async onClose() {
    var _a, _b;
    (_a = this.chapterCopyModal) == null ? void 0 : _a.close();
    this.chapterCopyModal = null;
    this.settleReadingStatsTime();
    this.clearReadingStatsPageTimer();
    this.saveProgressNow();
    window.clearTimeout(this.progressSaveTimer);
    window.clearTimeout(this.searchTimer);
    this.clearCursorHideTimer();
    (_b = this.resizeObserver) == null ? void 0 : _b.disconnect();
    if (this.boundGlobalKeydown) {
      document.removeEventListener("keydown", this.boundGlobalKeydown, true);
      window.removeEventListener("keydown", this.boundGlobalKeydown, true);
      this.boundGlobalKeydown = null;
    }
    if (this.boundMouseMove) {
      document.removeEventListener("mousemove", this.boundMouseMove, true);
      this.boundMouseMove = null;
    }
  }
  getState() {
    return { file: this.filePath };
  }
  async setState(state, result) {
    const viewState = state;
    const path = viewState == null ? void 0 : viewState.file;
    if (path && path !== this.filePath) {
      this.settleReadingStatsTime();
      this.clearReadingStatsPageTimer();
      this.filePath = path;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof import_obsidian.TFile) {
        this.currentFile = file;
        await this.loadContent();
      }
    }
    await super.setState(state, result);
    this.focusReader();
  }
  /** 供插件命令调用，打开当前阅读器的全文搜索。 */
  openSearch(query) {
    this.openSidebar("search", query);
  }
  /** 搜索快捷键重复触发时，在打开/关闭搜索面板之间切换。 */
  toggleSearchFromHotkey() {
    if (!this.shouldHandleSearchHotkey()) return;
    const selectedText = this.getSelectedSearchText();
    if (selectedText) {
      this.openSearch(selectedText);
      return;
    }
    if (this.isTocOpen && this.sidebarMode === "search") {
      this.closeSidebar();
      this.focusReader();
      return;
    }
    this.openSearch();
  }
  /** 全局设置面板保存后调用，让已打开阅读器立即使用新排版。 */
  refreshSettingsFromGlobal() {
    this.applyTypography();
    this.resetCursorIdleState();
    this.reprocessCurrentText(true);
  }
  /** 供外部打开/切换书籍后调用，把键盘焦点稳定交给阅读区。 */
  focusReader() {
    this.focusReadingAreaSoon();
  }
  buildUI() {
    const ce = this.contentEl;
    ce.empty();
    ce.addClass("puffs-reader-root");
    this.rootEl = ce.createDiv({ cls: "puffs-reader-wrapper" });
    this.bodyEl = this.rootEl.createDiv({ cls: "puffs-body" });
    this.buildTocSidebar();
    this.buildReadingArea();
    this.buildTypographyPanel();
    this.bindWorkspaceFocusEvents();
    this.bindGlobalKeys();
    this.bindCursorAutoHide();
    this.applyTypography();
    this.resetCursorIdleState();
  }
  bindWorkspaceFocusEvents() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
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
      })
    );
  }
  buildTocSidebar() {
    this.tocSidebar = this.bodyEl.createDiv({ cls: "puffs-toc-sidebar puffs-hidden" });
    const header = this.tocSidebar.createDiv({ cls: "puffs-toc-header" });
    this.tocTitleEl = header.createSpan({ cls: "puffs-toc-title", text: "\u76EE\u5F55" });
    this.tagsBtn = header.createEl("button", {
      cls: "puffs-icon-btn puffs-toc-search-btn",
      attr: { "aria-label": "\u4E66\u7C4D\u6807\u7B7E" }
    });
    (0, import_obsidian.setIcon)(this.tagsBtn, "tags");
    this.tagsBtn.addEventListener("click", () => this.openSidebar(this.sidebarMode === "tags" ? "toc" : "tags"));
    this.settingsBtn = header.createEl("button", {
      cls: "puffs-icon-btn puffs-toc-search-btn",
      attr: { "aria-label": "\u4E66\u7C4D\u8BBE\u7F6E" }
    });
    (0, import_obsidian.setIcon)(this.settingsBtn, "settings");
    this.settingsBtn.addEventListener("click", () => this.toggleTypography());
    this.tocModeBtn = header.createEl("button", {
      cls: "puffs-icon-btn puffs-toc-search-btn",
      attr: { "aria-label": "\u5168\u4E66\u641C\u7D22" }
    });
    (0, import_obsidian.setIcon)(this.tocModeBtn, "search");
    this.tocModeBtn.addEventListener("click", () => this.toggleSearchMode());
    this.tocTabsEl = this.tocSidebar.createDiv({ cls: "puffs-toc-tabs" });
    this.tocTabBtn = this.tocTabsEl.createDiv({ cls: "puffs-toc-tab", text: "\u76EE\u5F55" });
    this.notesTabBtn = this.tocTabsEl.createDiv({ cls: "puffs-toc-tab", text: "\u7B14\u8BB0" });
    this.tocTabBtn.addEventListener("click", () => this.switchSidebarMode("toc"));
    this.notesTabBtn.addEventListener("click", () => this.switchSidebarMode("notes"));
    this.tocListEl = this.tocSidebar.createDiv({ cls: "puffs-toc-list" });
    this.notesPaneEl = this.tocSidebar.createDiv({ cls: "puffs-notes-pane puffs-hidden" });
    this.tagsPaneEl = this.tocSidebar.createDiv({ cls: "puffs-tags-pane puffs-hidden" });
    this.searchPaneEl = this.tocSidebar.createDiv({ cls: "puffs-sidebar-search puffs-hidden" });
    const searchHeader = this.searchPaneEl.createDiv({ cls: "puffs-search-header" });
    this.searchInput = searchHeader.createEl("input", {
      cls: "puffs-search-input",
      attr: { type: "text", placeholder: "" }
    });
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.searchInput.addEventListener("input", () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.performSearch(this.searchInput.value), 160);
    });
    this.searchInfoEl = this.searchPaneEl.createDiv({ cls: "puffs-search-info" });
    this.searchResultsEl = this.searchPaneEl.createDiv({ cls: "puffs-search-results" });
  }
  buildReadingArea() {
    this.readingArea = this.bodyEl.createDiv({ cls: "puffs-reading-area" });
    this.readingArea.tabIndex = 0;
    this.chapterTitleEl = this.readingArea.createDiv({ cls: "puffs-page-chapter" });
    this.progressTitleEl = this.readingArea.createDiv({ cls: "puffs-page-progress" });
    this.searchBackBtn = this.readingArea.createEl("button", {
      cls: "puffs-search-back puffs-hidden",
      text: "\u8FD4\u56DE",
      attr: { "aria-label": "\u8FD4\u56DE\u641C\u7D22\u524D\u4F4D\u7F6E" }
    });
    this.searchBackBtn.addEventListener("click", () => this.returnFromSearchJump());
    this.contentContainer = this.readingArea.createDiv({ cls: "puffs-page-content" });
    this.contentContainer.addEventListener("contextmenu", (e) => this.handleAnnotationContextMenu(e));
    this.readingArea.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.readingArea.addEventListener("keyup", (e) => this.handleKeyup(e));
    this.readingArea.addEventListener("pointerdown", (e) => this.closePanelsOnOutsideClick(e));
    this.readingArea.addEventListener("wheel", (e) => {
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
  buildTypographyPanel() {
    this.typographyPanel = this.readingArea.createDiv({ cls: "puffs-typo-panel puffs-hidden" });
    this.refreshTypographyPanel();
  }
  async loadContent() {
    var _a, _b, _c;
    if (!this.currentFile) return;
    this.fileBuffer = await this.app.vault.readBinary(this.currentFile);
    const saved = this.plugin.getProgress(this.currentFile.path);
    const bookSettings = this.getBookSettings();
    const { text, encoding } = this.decodeBuffer(this.fileBuffer, (_a = bookSettings.encoding) != null ? _a : saved == null ? void 0 : saved.encoding);
    this.currentEncoding = encoding;
    this.paragraphs = this.processText(text);
    this.rebuildParagraphStartOffsets();
    this.parseChapters();
    this.buildTocList();
    this.updateSidebarTitle();
    this.applyTypography();
    this.currentPageStart = this.clampPosition({
      paraIndex: (_b = saved == null ? void 0 : saved.paragraphIndex) != null ? _b : 0,
      charOffset: (_c = saved == null ? void 0 : saved.charOffset) != null ? _c : 0
    });
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.focusReadingAreaSoon();
  }
  focusReadingAreaSoon() {
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
  decodeBuffer(buffer, forceEncoding) {
    if (forceEncoding) {
      try {
        return {
          text: new TextDecoder(forceEncoding, { fatal: false }).decode(buffer),
          encoding: forceEncoding
        };
      } catch (e) {
      }
    }
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
      return { text: new TextDecoder("utf-8").decode(buffer), encoding: "utf-8" };
    }
    if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) {
      return { text: new TextDecoder("utf-16le").decode(buffer), encoding: "utf-16le" };
    }
    if (bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255) {
      return { text: new TextDecoder("utf-16be").decode(buffer), encoding: "utf-16be" };
    }
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
        encoding: "utf-8"
      };
    } catch (e) {
    }
    try {
      return { text: new TextDecoder("gbk").decode(buffer), encoding: "gbk" };
    } catch (e) {
      const fallback = this.plugin.settings.defaultEncoding;
      return { text: new TextDecoder(fallback, { fatal: false }).decode(buffer), encoding: fallback };
    }
  }
  switchEncoding(encoding) {
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
      lastRead: Date.now()
    });
    this.refreshTypographyPanel();
    this.renderCurrentPage();
  }
  showEncodingMenu(e) {
    const menu = new import_obsidian.Menu();
    for (const enc of SUPPORTED_ENCODINGS) {
      menu.addItem(
        (item) => item.setTitle(enc.label).setChecked(this.currentEncoding === enc.value).onClick(() => this.switchEncoding(enc.value))
      );
    }
    menu.showAtMouseEvent(e);
  }
  processText(text) {
    let lines = text.split(/\r?\n/);
    if (this.getEffectiveRemoveExtraBlankLines()) {
      lines = lines.filter((line) => line.trim() !== "");
    }
    lines = this.removeBlankLinesAfterChapter(lines);
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    return lines;
  }
  reprocessCurrentText(preservePosition) {
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
    this.currentPageStart = preservePosition ? this.globalOffsetToPosition(currentOffset) : { paraIndex: 0, charOffset: 0 };
    this.currentPageEnd = this.currentPageStart;
    this.pageBackStack = [];
    if (this.searchQuery) {
      this.performSearch(this.searchQuery);
      return;
    }
    this.renderCurrentPage();
  }
  rebuildParagraphStartOffsets() {
    this.paragraphStartOffsets = [0];
    let offset = 0;
    for (let i = 0; i < this.paragraphs.length; i++) {
      offset += this.paragraphs[i].length;
      if (i < this.paragraphs.length - 1) offset += 1;
      this.paragraphStartOffsets.push(offset);
    }
  }
  /** 章节标题后面的空行只会拉开章节名和正文第一段，这里直接清理掉。 */
  removeBlankLinesAfterChapter(lines) {
    let regexes;
    try {
      regexes = this.getChapterMatchRegexes();
    } catch (e) {
      return lines;
    }
    if (regexes.length === 0) return lines;
    const cleaned = [];
    let previousWasChapter = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (previousWasChapter && trimmed === "") continue;
      cleaned.push(line);
      previousWasChapter = trimmed !== "" && regexes.some((regex) => regex.test(trimmed));
    }
    return cleaned;
  }
  renderCurrentPage() {
    if (this.paragraphs.length === 0) {
      this.clearReadingStatsPageTimer();
      this.contentContainer.empty();
      this.chapterTitleEl.textContent = "";
      this.progressTitleEl.textContent = "";
      return;
    }
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
  measurePageEnd(start) {
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
  paintPage(start, end) {
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
  createParagraphEl(text, paraIndex, charOffset, withHighlight, continuesAfterPage = false) {
    const p = document.createElement("p");
    p.className = "puffs-para";
    p.dataset.paraIndex = String(paraIndex);
    p.dataset.charOffset = String(charOffset);
    p.dataset.leadingIndentLength = String(this.getLeadingIndentLength(text, charOffset));
    if (charOffset > 0) {
      p.classList.add("puffs-para-fragment");
    }
    const chapter = charOffset === 0 ? this.getChapterStartingAt(paraIndex) : null;
    if (chapter) {
      p.classList.add("puffs-para-chapter");
      p.textContent = chapter.title;
      return p;
    }
    if (text.trim() === "") {
      p.classList.add("puffs-para-blank");
      p.innerHTML = "&nbsp;";
      return p;
    }
    if (continuesAfterPage) {
      p.classList.add("puffs-para-continued");
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
  buildDecoratedHTML(text, paraIndex, charOffset) {
    const end = charOffset + text.length;
    const annos = this.getAnnotations().map((a, idx) => ({ a, idx, segment: this.getAnnotationSegment(a, paraIndex) })).filter(({ segment }) => segment !== null && segment.startOffset < end && segment.endOffset > charOffset);
    const searches = this.searchResults.filter((m) => m.paraIndex === paraIndex && m.startOffset < end && m.startOffset + m.length > charOffset);
    if (annos.length === 0 && searches.length === 0) return null;
    const tokens = [];
    const leadingPlainEnd = this.getLeadingIndentLength(text, charOffset);
    for (const { a, idx, segment } of annos) {
      if (!segment) continue;
      const localStart = Math.max(leadingPlainEnd, segment.startOffset - charOffset);
      const localEnd = Math.min(text.length, segment.endOffset - charOffset);
      if (localEnd <= localStart) continue;
      tokens.push({
        start: localStart,
        end: localEnd,
        kind: "anno",
        annoIdx: idx,
        hasNote: !!a.note
      });
    }
    for (const m of searches) {
      const localStart = Math.max(leadingPlainEnd, m.startOffset - charOffset);
      const localEnd = Math.min(text.length, m.startOffset + m.length - charOffset);
      if (localEnd <= localStart) continue;
      tokens.push({ start: localStart, end: localEnd, kind: "search" });
    }
    tokens.sort((a, b) => a.start - b.start || (a.kind === "anno" ? -1 : 1));
    let result = "";
    let cursor = leadingPlainEnd;
    for (const t of tokens) {
      if (t.start < cursor) continue;
      if (t.start > cursor) result += this.escapeHTML(text.slice(cursor, t.start));
      const inner = text.slice(t.start, t.end);
      if (t.kind === "search") {
        result += `<span class="puffs-search-hl">${this.escapeHTML(inner)}</span>`;
      } else {
        const cls = t.hasNote ? "puffs-annotation puffs-has-note" : "puffs-annotation";
        const idxAttr = t.annoIdx !== void 0 ? ` data-anno-idx="${t.annoIdx}"` : "";
        result += `<span class="${cls}"${idxAttr}>${this.escapeHTML(inner)}</span>`;
      }
      cursor = t.end;
    }
    if (cursor < text.length) result += this.escapeHTML(text.slice(cursor));
    return result;
  }
  getLeadingIndentLength(text, charOffset) {
    var _a, _b;
    if (charOffset !== 0) return 0;
    return (_b = (_a = text.match(/^[\s\u3000]+/)) == null ? void 0 : _a[0].length) != null ? _b : 0;
  }
  getRenderableParagraphText(text, charOffset) {
    const leadingLength = this.getLeadingIndentLength(text, charOffset);
    return leadingLength > 0 ? text.slice(leadingLength) : text;
  }
  isContentOverflowing() {
    return this.contentContainer.scrollHeight > this.contentContainer.clientHeight;
  }
  /** 最终以真实绘制结果兜底，尽量只截短最后一段，减少页底空白。 */
  trimPaintedPageToFit() {
    var _a, _b;
    let guard = 0;
    while (this.isContentOverflowing() && guard < 20) {
      const last = this.contentContainer.lastElementChild;
      if (!last) return;
      const paraIndex = Number(last.dataset.paraIndex);
      const charOffset = Number(last.dataset.charOffset);
      if (!Number.isFinite(paraIndex) || !Number.isFinite(charOffset)) return;
      const paragraphEnd = paraIndex === this.currentPageEnd.paraIndex ? this.currentPageEnd.charOffset : (_b = (_a = this.paragraphs[paraIndex]) == null ? void 0 : _a.length) != null ? _b : charOffset;
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
  fillPaintedPageToFit() {
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
      let localBest = null;
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
  getCurrentPageFillLimit() {
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
  findLastCompleteLineOffset(para, text) {
    var _a, _b;
    if (text.length === 0) return 0;
    const style = getComputedStyle(this.contentContainer);
    const bottomPadding = parseFloat(style.paddingBottom || "0") || 0;
    const bottomGuard = 1;
    const bottomLimit = this.contentContainer.getBoundingClientRect().bottom - bottomPadding - bottomGuard;
    const range = document.createRange();
    let lastLineTop = Number.NaN;
    let lastLineBottom = 0;
    let lastCompleteOffset = 0;
    const paraCharOffset = Number(para.dataset.charOffset);
    let globalOffset = this.getLeadingIndentLength(text, Number.isFinite(paraCharOffset) ? paraCharOffset : 0);
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    outer:
      while (node) {
        const length = (_b = (_a = node.textContent) == null ? void 0 : _a.length) != null ? _b : 0;
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
        node = walker.nextNode();
      }
    if (lastLineBottom <= bottomLimit) lastCompleteOffset = Math.min(globalOffset, text.length);
    range.detach();
    return lastCompleteOffset;
  }
  pageDown() {
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
  pageUp() {
    var _a;
    if (this.currentPageStart.paraIndex === 0 && this.currentPageStart.charOffset === 0) return false;
    this.settleReadingStatsTime(Date.now(), true);
    this.clearReadingStatsPageTimer();
    this.currentPageStart = (_a = this.pageBackStack.pop()) != null ? _a : this.findPreviousPageStart(this.currentPageStart);
    this.recordPageTurnAfterSearchJump();
    this.renderCurrentPage();
    this.readingArea.focus();
    return true;
  }
  tryManualPageTurn(direction) {
    if (!this.canManualPageTurnNow()) return;
    const didTurn = direction === "next" ? this.pageDown() : this.pageUp();
    if (didTurn) this.lastManualPageTurnAt = performance.now();
  }
  canManualPageTurnNow() {
    const limit = this.plugin.settings.manualPageTurnsPerSecond;
    if (!Number.isFinite(limit) || limit <= 0) return true;
    if (this.lastManualPageTurnAt === 0) return true;
    const now = performance.now();
    const minIntervalMs = 1e3 / limit;
    return now - this.lastManualPageTurnAt >= minIntervalMs;
  }
  /** 反向翻页用前向测量逼近，保证上一页结束位置正好衔接当前页首。 */
  findPreviousPageStart(target) {
    let windowStart = Math.max(0, target.paraIndex - 160);
    let bestStart = { paraIndex: 0, charOffset: 0 };
    while (true) {
      let pos = { paraIndex: windowStart, charOffset: 0 };
      let previous = pos;
      let guard = 0;
      while (this.comparePositions(pos, target) < 0 && guard < 2e3) {
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
  jumpToPosition(pos) {
    this.settleReadingStatsTime(Date.now(), true);
    this.clearReadingStatsPageTimer();
    this.currentPageStart = this.clampPosition(pos);
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }
  clampPosition(pos) {
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
      charOffset: this.normalizePageCharOffset(paragraph, clampedOffset)
    };
  }
  normalizePageCharOffset(paragraph, charOffset) {
    const leadingLength = this.getLeadingIndentLength(paragraph, 0);
    return charOffset <= leadingLength ? 0 : charOffset;
  }
  skipBlankPageStart(pos) {
    let next = this.clampPosition(pos);
    while (next.paraIndex < this.paragraphs.length && next.charOffset === 0 && this.paragraphs[next.paraIndex].trim() === "") {
      next = this.clampPosition({ paraIndex: next.paraIndex + 1, charOffset: 0 });
    }
    return next;
  }
  comparePositions(a, b) {
    if (a.paraIndex !== b.paraIndex) return a.paraIndex - b.paraIndex;
    return a.charOffset - b.charOffset;
  }
  positionToGlobalOffset(pos) {
    var _a, _b;
    if (this.paragraphs.length === 0) return 0;
    const clamped = this.clampPosition(pos);
    if (clamped.paraIndex >= this.paragraphs.length) {
      return (_a = this.paragraphStartOffsets[this.paragraphs.length]) != null ? _a : 0;
    }
    return ((_b = this.paragraphStartOffsets[clamped.paraIndex]) != null ? _b : 0) + clamped.charOffset;
  }
  globalOffsetToPosition(offset) {
    var _a, _b, _c;
    if (this.paragraphs.length === 0) return { paraIndex: 0, charOffset: 0 };
    const total = (_a = this.paragraphStartOffsets[this.paragraphs.length]) != null ? _a : 0;
    const target = Math.max(0, Math.min(offset, total));
    if (target >= total) return { paraIndex: this.paragraphs.length, charOffset: 0 };
    let low = 0;
    let high = this.paragraphs.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = (_b = this.paragraphStartOffsets[mid]) != null ? _b : 0;
      const next = (_c = this.paragraphStartOffsets[mid + 1]) != null ? _c : start;
      if (target < start) {
        high = mid - 1;
      } else if (target >= next) {
        low = mid + 1;
      } else {
        return {
          paraIndex: mid,
          charOffset: Math.min(target - start, this.paragraphs[mid].length)
        };
      }
    }
    return { paraIndex: this.paragraphs.length, charOffset: 0 };
  }
  getCurrentPageStatsRange() {
    if (this.paragraphs.length === 0) return null;
    const start = this.clampPosition(this.currentPageStart);
    const end = this.clampPosition(this.currentPageEnd);
    const startOffset = this.positionToGlobalOffset(start);
    const endOffset = this.positionToGlobalOffset(end);
    if (endOffset <= startOffset) return null;
    return { start, end, startOffset, endOffset };
  }
  scheduleReadingPageStats() {
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
  clearReadingStatsPageTimer() {
    if (this.readingStatsTimer) {
      window.clearTimeout(this.readingStatsTimer);
      this.readingStatsTimer = 0;
    }
    this.readingStatsPageKey = "";
  }
  getReadingStatsPageKey(range) {
    var _a, _b;
    return `${(_b = (_a = this.currentFile) == null ? void 0 : _a.path) != null ? _b : ""}:${range.startOffset}:${range.endOffset}`;
  }
  commitReadingPageStats(pageKey) {
    var _a, _b;
    if (!this.currentFile || !this.isReadingStatsActive()) return;
    const range = this.getCurrentPageStatsRange();
    if (!range || pageKey !== this.getReadingStatsPageKey(range)) return;
    const countedRange = { start: range.startOffset, end: range.endOffset };
    const existingRanges = (_b = (_a = this.plugin.getReadingStats().books[this.currentFile.path]) == null ? void 0 : _a.countedRanges) != null ? _b : [];
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
      timestamp: Date.now()
    }).catch((error) => console.error("[Puffs Reader] Failed to record reading page stats:", error));
  }
  settleReadingStatsTime(now = Date.now(), keepSession = false) {
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
        timestamp: now
      }).catch((error) => console.error("[Puffs Reader] Failed to record reading time:", error));
    }
    this.readingStatsLastTurnAt = keepSession ? now : 0;
  }
  isReadingStatsActive() {
    return this.app.workspace.activeLeaf === this.leaf && document.hasFocus();
  }
  getReadingStatsMinPageMs() {
    const value = Number(this.plugin.settings.readingStatsMinPageMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_READING_STATS_PAGE_MIN_MS;
  }
  getReadingStatsIdleLimitMs() {
    const value = Number(this.plugin.settings.readingStatsIdleLimitMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_READING_STATS_IDLE_LIMIT_MS;
  }
  getUncountedRanges(range, existing) {
    let pending = [{ ...range }];
    const sorted = [...existing].filter((item) => item.end > item.start).sort((a, b) => a.start - b.start || a.end - b.end);
    for (const counted of sorted) {
      const next = [];
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
  countWordsInGlobalRanges(ranges) {
    return ranges.reduce((sum, range) => sum + this.getTextInGlobalRange(range.start, range.end).replace(/\s+/g, "").length, 0);
  }
  getTextInGlobalRange(startOffset, endOffset) {
    var _a;
    const start = this.globalOffsetToPosition(startOffset);
    const end = this.globalOffsetToPosition(endOffset);
    const parts = [];
    for (let pi = start.paraIndex; pi <= end.paraIndex && pi < this.paragraphs.length; pi++) {
      const paragraph = (_a = this.paragraphs[pi]) != null ? _a : "";
      const begin = pi === start.paraIndex ? start.charOffset : 0;
      const finish = pi === end.paraIndex ? end.charOffset : paragraph.length;
      if (finish > begin) parts.push(paragraph.slice(begin, finish));
    }
    return parts.join("\n");
  }
  getReadChapterRangesForPage(start, end) {
    var _a, _b;
    if (this.chapters.length === 0) {
      return [{ start: -1, end: -1, startTitle: "\u672A\u8BC6\u522B\u7AE0\u8282", endTitle: "\u672A\u8BC6\u522B\u7AE0\u8282" }];
    }
    const startPara = Math.max(0, Math.min(start.paraIndex, Math.max(0, this.paragraphs.length - 1)));
    const endPara = this.getVisiblePageEndParaIndex(start, end);
    const indices = [];
    for (let i = 0; i < this.chapters.length; i++) {
      const chapterStart = this.chapters[i].startParaIndex;
      const chapterEnd = (_b = (_a = this.chapters[i + 1]) == null ? void 0 : _a.startParaIndex) != null ? _b : this.paragraphs.length;
      if (chapterStart <= endPara && chapterEnd > startPara) indices.push(i);
    }
    if (indices.length === 0) {
      return [{ start: -1, end: -1, startTitle: "\u672A\u8BC6\u522B\u7AE0\u8282", endTitle: "\u672A\u8BC6\u522B\u7AE0\u8282" }];
    }
    const startIndex = indices[0];
    const endIndex = indices[indices.length - 1];
    return [{
      start: startIndex,
      end: endIndex,
      startTitle: this.chapters[startIndex].title,
      endTitle: this.chapters[endIndex].title
    }];
  }
  getVisiblePageEndParaIndex(start, end) {
    if (this.paragraphs.length === 0) return 0;
    if (end.paraIndex >= this.paragraphs.length) return this.paragraphs.length - 1;
    if (end.charOffset === 0 && end.paraIndex > start.paraIndex) return end.paraIndex - 1;
    return Math.max(start.paraIndex, end.paraIndex);
  }
  parseChapters() {
    this.chapters = [];
    this.collapsedTocGroups.clear();
    let regexes;
    try {
      regexes = this.getChapterMatchRegexes();
    } catch (e) {
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
          level: this.getTocIndentLevel(line)
        });
      }
    }
  }
  getTocIndentLevel(line) {
    var _a, _b, _c;
    const settings = this.getBookSettings();
    if (!settings.tocIndentEnabled) return 1;
    const marker = this.extractChapterMarker(line);
    if (!marker) return 1;
    try {
      const level1Regex = new RegExp(((_a = settings.tocIndentLevel1Regex) == null ? void 0 : _a.trim()) || "\u5377");
      const level2Regex = new RegExp(((_b = settings.tocIndentLevel2Regex) == null ? void 0 : _b.trim()) || "\u7AE0");
      const level3Regex = new RegExp(((_c = settings.tocIndentLevel3Regex) == null ? void 0 : _c.trim()) || "\u8282");
      if (level1Regex.test(marker)) return 1;
      if (level2Regex.test(marker)) return 2;
      if (level3Regex.test(marker)) return 3;
    } catch (e) {
      return 1;
    }
    return 1;
  }
  extractChapterMarker(line) {
    var _a, _b, _c;
    const customRegex = (_a = this.getBookSettings().chapterTitleRegex) != null ? _a : this.plugin.settings.chapterTitleRegex;
    try {
      const match = line.match(new RegExp(customRegex));
      return (_c = (_b = match == null ? void 0 : match[2]) == null ? void 0 : _b.trim()) != null ? _c : "";
    } catch (e) {
      return "";
    }
  }
  extractChapterTitle(line) {
    var _a, _b, _c, _d;
    const customRegex = (_a = this.getBookSettings().chapterTitleRegex) != null ? _a : this.plugin.settings.chapterTitleRegex;
    try {
      const match = line.match(new RegExp(customRegex));
      if ((match == null ? void 0 : match[1]) && (match == null ? void 0 : match[2]) && /^[章节回卷集部篇]$/.test(match[2])) {
        const numberText = this.normalizeChapterNumber(match[1]);
        const titleText = ((_b = match[3]) != null ? _b : "").trim();
        return titleText ? `\u7B2C${numberText}${match[2]} ${titleText}` : `\u7B2C${numberText}${match[2]}`;
      }
      const captured = (_c = match == null ? void 0 : match.slice(1).find((part) => part && part.trim().length > 0)) == null ? void 0 : _c.trim();
      if (captured) return captured;
    } catch (e) {
    }
    try {
      const match = line.match(new RegExp(this.getEffectivePrologueTitleRegex()));
      const captured = (_d = match == null ? void 0 : match.slice(1).find((part) => part && part.trim().length > 0)) == null ? void 0 : _d.trim();
      if (captured) return captured;
      if (match) return line.trim();
    } catch (e) {
    }
    return line;
  }
  getChapterEndPara(paraIndex) {
    var _a, _b;
    const active = this.getActiveChapterIndex(paraIndex);
    if (active < 0) return null;
    return (_b = (_a = this.chapters[active + 1]) == null ? void 0 : _a.startParaIndex) != null ? _b : null;
  }
  buildTocList() {
    if (!this.tocListEl) return;
    this.tocListEl.empty();
    if (this.chapters.length === 0) {
      this.tocListEl.createDiv({ cls: "puffs-toc-empty", text: "\u672A\u68C0\u6D4B\u5230\u7AE0\u8282" });
      return;
    }
    this.chapters.forEach((ch, index) => {
      if (this.isTocChildHidden(index)) return;
      const item = this.tocListEl.createDiv({ cls: "puffs-toc-item" });
      item.dataset.chapterIndex = String(index);
      const displayLevel = this.getTocDisplayLevel(index);
      item.classList.add(`puffs-toc-level-${displayLevel}`);
      if (this.hasTocChildren(index)) {
        const toggle = item.createEl("button", {
          cls: "puffs-toc-toggle",
          attr: { "aria-label": this.collapsedTocGroups.has(index) ? "\u5C55\u5F00" : "\u6536\u8D77" }
        });
        (0, import_obsidian.setIcon)(toggle, this.collapsedTocGroups.has(index) ? "chevron-right" : "chevron-down");
        toggle.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleTocGroup(index);
        });
      }
      item.createSpan({ cls: "puffs-toc-item-title", text: ch.title });
      item.addEventListener("click", () => {
        this.jumpToPosition({ paraIndex: ch.startParaIndex, charOffset: 0 });
        this.applySidebarMode("toc");
      });
    });
  }
  hasTocChildren(index) {
    var _a, _b;
    const level = (_b = (_a = this.chapters[index]) == null ? void 0 : _a.level) != null ? _b : 1;
    for (let i = index + 1; i < this.chapters.length; i++) {
      if (this.chapters[i].level <= level) return false;
      if (this.chapters[i].level > level) return true;
    }
    return false;
  }
  isTocChildHidden(index) {
    let parentIndex = this.getTocParentIndex(index);
    while (parentIndex !== null) {
      if (this.collapsedTocGroups.has(parentIndex)) return true;
      parentIndex = this.getTocParentIndex(parentIndex);
    }
    return false;
  }
  getTocParentIndex(index) {
    var _a, _b;
    const level = (_b = (_a = this.chapters[index]) == null ? void 0 : _a.level) != null ? _b : 1;
    if (level <= 1) return null;
    for (let i = index - 1; i >= 0; i--) {
      if (this.chapters[i].level < level) return i;
    }
    return null;
  }
  getTocDisplayLevel(index) {
    let displayLevel = 1;
    let parentIndex = this.getTocParentIndex(index);
    while (parentIndex !== null) {
      displayLevel++;
      parentIndex = this.getTocParentIndex(parentIndex);
    }
    return Math.min(3, displayLevel);
  }
  getVisibleTocIndex(index) {
    let visibleIndex = index;
    let parentIndex = this.getTocParentIndex(index);
    while (parentIndex !== null) {
      if (this.collapsedTocGroups.has(parentIndex)) visibleIndex = parentIndex;
      parentIndex = this.getTocParentIndex(parentIndex);
    }
    return visibleIndex;
  }
  toggleTocGroup(index) {
    if (this.collapsedTocGroups.has(index)) this.collapsedTocGroups.delete(index);
    else this.collapsedTocGroups.add(index);
    this.buildTocList();
    this.highlightCurrentTocItem(this.getActiveChapterIndex(this.currentPageStart.paraIndex));
  }
  updatePageMeta() {
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    if (this.plugin.settings.showChapterTitle) {
      this.chapterTitleEl.textContent = activeChapter >= 0 ? this.chapters[activeChapter].title : "";
      this.chapterTitleEl.classList.remove("puffs-hidden");
    } else {
      this.chapterTitleEl.classList.add("puffs-hidden");
    }
    this.highlightCurrentTocItem(activeChapter);
    if (this.plugin.settings.showProgress) {
      const current = Math.min(this.currentPageStart.paraIndex, this.paragraphs.length);
      const pct = this.paragraphs.length > 0 ? (current / this.paragraphs.length * 100).toFixed(1) : "0.0";
      this.progressTitleEl.textContent = `${pct}%`;
      this.progressTitleEl.classList.remove("puffs-hidden");
    } else {
      this.progressTitleEl.classList.add("puffs-hidden");
    }
  }
  getActiveChapterIndex(paraIndex) {
    let active = -1;
    for (let i = 0; i < this.chapters.length; i++) {
      if (this.chapters[i].startParaIndex <= paraIndex) active = i;
      else break;
    }
    return active;
  }
  highlightCurrentTocItem(idx) {
    var _a;
    const visibleIdx = this.getVisibleTocIndex(idx);
    (_a = this.tocListEl) == null ? void 0 : _a.querySelectorAll(".puffs-toc-item").forEach((el) => {
      el.classList.toggle("puffs-toc-active", Number(el.dataset.chapterIndex) === visibleIdx);
    });
  }
  toggleToc() {
    if (this.isTocOpen) {
      this.closeSidebar();
    } else {
      this.openSidebar("toc");
    }
  }
  closeSidebar() {
    this.isTocOpen = false;
    this.tocSidebar.classList.add("puffs-hidden");
    this.readingArea.focus();
  }
  openSidebar(mode, searchQuery) {
    this.isTocOpen = true;
    this.tocSidebar.classList.remove("puffs-hidden");
    this.applySidebarMode(mode);
    if (mode === "toc") {
      requestAnimationFrame(() => this.scrollTocToActiveChapter());
    } else if (mode === "search") {
      if (searchQuery !== void 0) {
        this.setSearchInput(searchQuery);
      } else {
        this.clearSearchInput();
      }
      requestAnimationFrame(() => {
        this.searchInput.focus();
        if (searchQuery !== void 0) this.searchInput.select();
      });
    } else if (mode === "notes") {
      this.renderNotesPane();
    } else if (mode === "tags") {
      this.renderTagsPane();
    }
  }
  toggleSearchMode() {
    this.openSidebar(this.sidebarMode === "search" ? "toc" : "search");
  }
  switchSidebarMode(mode) {
    if (this.sidebarMode === mode) return;
    this.openSidebar(mode);
  }
  applySidebarMode(mode) {
    var _a, _b;
    this.sidebarMode = mode;
    const inSearch = mode === "search";
    const inTags = mode === "tags";
    this.tocTitleEl.textContent = inSearch ? "\u5168\u4E66\u641C\u7D22" : inTags ? "\u4E66\u7C4D\u6807\u7B7E" : (_b = (_a = this.currentFile) == null ? void 0 : _a.basename) != null ? _b : "\u76EE\u5F55";
    (0, import_obsidian.setIcon)(this.tocModeBtn, inSearch ? "list" : "search");
    this.tocModeBtn.setAttribute("aria-label", inSearch ? "\u8FD4\u56DE\u76EE\u5F55" : "\u5168\u4E66\u641C\u7D22");
    this.tocModeBtn.removeAttribute("title");
    this.tagsBtn.classList.toggle("is-active", inTags);
    this.tagsBtn.setAttribute("aria-pressed", inTags ? "true" : "false");
    this.tocTabsEl.classList.toggle("puffs-hidden", inSearch || inTags);
    this.tocTabBtn.classList.toggle("puffs-toc-tab-active", mode === "toc");
    this.notesTabBtn.classList.toggle("puffs-toc-tab-active", mode === "notes");
    this.tocListEl.classList.toggle("puffs-hidden", mode !== "toc");
    this.notesPaneEl.classList.toggle("puffs-hidden", mode !== "notes");
    this.tagsPaneEl.classList.toggle("puffs-hidden", mode !== "tags");
    this.searchPaneEl.classList.toggle("puffs-hidden", mode !== "search");
  }
  updateSidebarTitle() {
    var _a, _b;
    if (!this.tocTitleEl || this.sidebarMode === "search" || this.sidebarMode === "tags") return;
    this.tocTitleEl.textContent = (_b = (_a = this.currentFile) == null ? void 0 : _a.basename) != null ? _b : "\u76EE\u5F55";
  }
  scrollTocToActiveChapter() {
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    if (activeChapter < 0) return;
    const visibleChapter = this.getVisibleTocIndex(activeChapter);
    const item = this.tocListEl.querySelector(`.puffs-toc-item[data-chapter-index="${visibleChapter}"]`);
    if (!item) return;
    item.scrollIntoView({ block: "center" });
  }
  clearSearchInput() {
    this.searchQuery = "";
    this.searchResults = [];
    this.searchInput.value = "";
    this.searchInfoEl.textContent = "";
    this.searchResultsEl.empty();
    this.renderCurrentPage();
  }
  setSearchInput(query) {
    this.searchInput.value = query;
    window.clearTimeout(this.searchTimer);
    this.performSearch(query);
  }
  performSearch(query) {
    this.searchQuery = query.trim();
    this.searchResults = [];
    if (!this.searchQuery) {
      this.searchInfoEl.textContent = "";
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
    this.searchInfoEl.textContent = this.searchResults.length > 0 ? `${this.searchResults.length} \u4E2A\u7ED3\u679C` : "\u65E0\u7ED3\u679C";
    this.renderSearchResults();
    this.renderCurrentPage();
  }
  renderSearchResults() {
    this.searchResultsEl.empty();
    if (this.searchResults.length === 0) {
      this.searchResultsEl.createDiv({ cls: "puffs-search-empty", text: "\u6CA1\u6709\u627E\u5230\u5339\u914D\u5185\u5BB9" });
      return;
    }
    const seen = /* @__PURE__ */ new Set();
    const grouped = this.searchResults.filter((match) => {
      if (seen.has(match.paraIndex)) return false;
      seen.add(match.paraIndex);
      return true;
    }).slice(0, 200);
    grouped.forEach((match) => {
      const card = this.searchResultsEl.createDiv({ cls: "puffs-search-card" });
      const chapter = this.getActiveChapterIndex(match.paraIndex);
      card.createDiv({
        cls: "puffs-search-card-title",
        text: chapter >= 0 ? this.chapters[chapter].title : `\u7B2C ${match.paraIndex + 1} \u6BB5`
      });
      const preview = card.createDiv({ cls: "puffs-search-card-preview" });
      preview.innerHTML = this.buildSearchPreview(match);
      card.addEventListener("click", () => {
        this.searchJumpBackPos = { ...this.currentPageStart };
        this.searchJumpPageTurns = 0;
        this.searchBackBtn.classList.remove("puffs-hidden");
        this.jumpToPosition({ paraIndex: match.paraIndex, charOffset: match.startOffset });
      });
    });
  }
  buildSearchPreview(match) {
    const text = this.paragraphs[match.paraIndex];
    const start = Math.max(0, match.startOffset - 56);
    const end = Math.min(text.length, match.startOffset + match.length + 56);
    const localStart = match.startOffset - start;
    const localEnd = localStart + match.length;
    const visible = text.slice(start, end);
    return `${start > 0 ? "..." : ""}${this.escapeHTML(visible.slice(0, localStart))}<mark>${this.escapeHTML(visible.slice(localStart, localEnd))}</mark>${this.escapeHTML(visible.slice(localEnd))}${end < text.length ? "..." : ""}`;
  }
  returnFromSearchJump() {
    if (!this.searchJumpBackPos) return;
    const target = this.searchJumpBackPos;
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.searchBackBtn.classList.add("puffs-hidden");
    this.currentPageStart = this.clampPosition(target);
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }
  recordPageTurnAfterSearchJump() {
    if (!this.searchJumpBackPos) return;
    this.searchJumpPageTurns += 1;
    if (this.searchJumpPageTurns >= 5) {
      this.clearSearchJumpAndHighlights();
    }
  }
  clearSearchJumpAndHighlights() {
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.searchBackBtn.classList.add("puffs-hidden");
    this.clearSearchInput();
  }
  refreshTypographyPanel() {
    var _a, _b;
    const p = this.typographyPanel;
    p.empty();
    const bookSettings = this.getBookSettings();
    const title = p.createDiv({ cls: "puffs-typo-title" });
    title.createSpan({ text: "\u4E66\u7C4D\u8BBE\u7F6E" });
    const encodingRow = p.createDiv({ cls: "puffs-typo-row" });
    encodingRow.createSpan({ cls: "puffs-typo-label", text: "\u7F16\u7801\u65B9\u5F0F" });
    this.encodingBtn = encodingRow.createEl("button", {
      cls: "puffs-icon-btn puffs-encoding-btn",
      text: this.currentEncoding.toUpperCase(),
      attr: { "aria-label": "\u5207\u6362\u7F16\u7801" }
    });
    this.encodingBtn.addEventListener("click", (e) => this.showEncodingMenu(e));
    this.addNumberRow(
      p,
      "\u9996\u884C\u7F29\u8FDB",
      this.getEffectiveFirstLineIndent(),
      0,
      4,
      0.1,
      "em",
      (v) => {
        this.updateBookSettings({ firstLineIndent: v });
        this.applyTypography();
        this.renderCurrentPage();
      }
    );
    this.addTextRow(p, "\u76EE\u5F55\u6B63\u5219", this.getEffectiveTocRegex(), (v) => {
      this.updateBookSettings({ tocRegex: v || void 0 });
      this.parseChapters();
      this.buildTocList();
      this.renderCurrentPage();
    });
    this.addTextRow(p, "\u7AE0\u540D\u6B63\u5219", (_a = bookSettings.chapterTitleRegex) != null ? _a : this.plugin.settings.chapterTitleRegex, (v) => {
      this.updateBookSettings({ chapterTitleRegex: v || void 0 });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addTextRow(p, "\u5E8F\u7AE0\u5339\u914D", (_b = bookSettings.prologueTitleRegex) != null ? _b : this.plugin.settings.prologueTitleRegex, (v) => {
      this.updateBookSettings({ prologueTitleRegex: v || void 0 });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addToggleRow(p, "\u53BB\u9664\u591A\u4F59\u7A7A\u884C", this.getEffectiveRemoveExtraBlankLines(), (v) => {
      this.updateBookSettings({ removeExtraBlankLines: v });
      this.reprocessCurrentText(true);
    });
    this.addTocIndentRows(p, bookSettings);
    const exportRow = p.createDiv({ cls: "puffs-typo-row" });
    exportRow.createSpan({ cls: "puffs-typo-label", text: "\u6807\u6CE8\u4E0E\u6279\u6CE8" });
    const exportBtn = exportRow.createEl("button", {
      cls: "puffs-icon-btn",
      text: "\u5BFC\u51FA Markdown"
    });
    exportBtn.addEventListener("click", () => this.exportAnnotations());
  }
  addNumberRow(parent, label, value, min, max, step, unit, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: label });
    const input = row.createEl("input", {
      cls: "puffs-typo-number",
      attr: { type: "number", min: String(min), max: String(max), step: String(step) }
    });
    input.value = String(value);
    row.createSpan({ cls: "puffs-typo-unit", text: unit });
    input.addEventListener("change", () => {
      const parsed = Number(input.value);
      if (Number.isNaN(parsed)) return;
      const next = Math.min(max, Math.max(min, parsed));
      input.value = String(next);
      onChange(next);
    });
  }
  addTextRow(parent, label, value, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: label });
    const input = row.createEl("input", { cls: "puffs-typo-text-input", attr: { type: "text" } });
    input.value = value;
    input.addEventListener("change", () => onChange(input.value.trim()));
  }
  addToggleRow(parent, label, value, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: label });
    const toggle = row.createEl("input", {
      cls: "puffs-typo-toggle",
      attr: { type: "checkbox" }
    });
    toggle.checked = value;
    toggle.addEventListener("change", () => onChange(toggle.checked));
  }
  addTocIndentRows(parent, bookSettings) {
    var _a, _b, _c;
    const enabled = !!bookSettings.tocIndentEnabled;
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: "\u76EE\u5F55\u7F29\u8FDB" });
    const toggle = row.createEl("input", {
      cls: "puffs-typo-toggle",
      attr: { type: "checkbox" }
    });
    toggle.checked = enabled;
    toggle.addEventListener("change", () => {
      var _a2, _b2, _c2;
      this.updateBookSettings({
        tocIndentEnabled: toggle.checked,
        tocIndentLevel1Regex: toggle.checked ? ((_a2 = bookSettings.tocIndentLevel1Regex) == null ? void 0 : _a2.trim()) || "\u5377" : void 0,
        tocIndentLevel2Regex: toggle.checked ? ((_b2 = bookSettings.tocIndentLevel2Regex) == null ? void 0 : _b2.trim()) || "\u7AE0" : void 0,
        tocIndentLevel3Regex: toggle.checked ? ((_c2 = bookSettings.tocIndentLevel3Regex) == null ? void 0 : _c2.trim()) || "\u8282" : void 0
      });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
      this.refreshTypographyPanel();
    });
    if (!enabled) return;
    this.addTextRow(parent, "1\u7EA7\u5173\u952E\u5B57\u6B63\u5219", (_a = bookSettings.tocIndentLevel1Regex) != null ? _a : "\u5377", (v) => {
      this.updateBookSettings({ tocIndentLevel1Regex: v || "\u5377" });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addTextRow(parent, "2\u7EA7\u5173\u952E\u5B57\u6B63\u5219", (_b = bookSettings.tocIndentLevel2Regex) != null ? _b : "\u7AE0", (v) => {
      this.updateBookSettings({ tocIndentLevel2Regex: v || "\u7AE0" });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addTextRow(parent, "3\u7EA7\u5173\u952E\u5B57\u6B63\u5219", (_c = bookSettings.tocIndentLevel3Regex) != null ? _c : "\u8282", (v) => {
      this.updateBookSettings({ tocIndentLevel3Regex: v || "\u8282" });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
  }
  applyTypography() {
    var _a;
    if (!this.rootEl || !this.contentContainer) return;
    const s = this.plugin.settings;
    const rgbBg = s.backgroundColor ? `rgb(${s.backgroundColor})` : "";
    const rgbFont = s.fontColor ? `rgb(${s.fontColor})` : "";
    const chapterColor = s.chapterMetaColor ? `rgb(${s.chapterMetaColor})` : "";
    const progressColor = s.progressMetaColor ? `rgb(${s.progressMetaColor})` : "";
    this.rootEl.style.setProperty("--puffs-bg-color", rgbBg || "var(--background-primary)");
    this.readingArea.style.setProperty("--puffs-bg-color", rgbBg || "var(--background-primary)");
    this.contentContainer.style.setProperty("--puffs-font-size", `${s.fontSize}px`);
    this.contentContainer.style.setProperty("--puffs-line-height", String(s.lineHeight));
    this.contentContainer.style.setProperty("--puffs-para-spacing", `${s.paragraphSpacing}px`);
    this.contentContainer.style.setProperty("--puffs-indent", `${this.getEffectiveFirstLineIndent()}em`);
    this.contentContainer.style.setProperty("--puffs-content-width", `${s.contentWidth}px`);
    this.contentContainer.style.setProperty("--puffs-letter-spacing", `${s.letterSpacing}px`);
    this.contentContainer.style.setProperty("--puffs-padding-top", `${s.paddingTop}px`);
    this.contentContainer.style.setProperty("--puffs-padding-bottom", `${s.paddingBottom}px`);
    this.rootEl.style.setProperty("--puffs-sidebar-width", `${s.sidebarWidth}px`);
    this.rootEl.style.setProperty("--puffs-sidebar-transition", `${s.sidebarTransitionMs}ms`);
    this.rootEl.style.setProperty("--puffs-toc-font-size", `${s.tocFontSize}px`);
    this.rootEl.style.setProperty("--puffs-sidebar-title-size", `${(_a = s.sidebarTitleFontSize) != null ? _a : 16}px`);
    this.rootEl.style.setProperty("--puffs-chapter-meta-size", `${s.chapterMetaFontSize}px`);
    this.rootEl.style.setProperty("--puffs-chapter-meta-top", `${s.chapterMetaTop}px`);
    this.rootEl.style.setProperty("--puffs-progress-meta-size", `${s.progressMetaFontSize}px`);
    this.rootEl.style.setProperty("--puffs-progress-meta-bottom", `${s.progressMetaBottom}px`);
    if (rgbFont) this.contentContainer.style.setProperty("--puffs-font-color", rgbFont);
    else this.contentContainer.style.removeProperty("--puffs-font-color");
    const annoBg = s.annotationHighlightColor ? `rgba(${s.annotationHighlightColor},0.42)` : "";
    if (annoBg) this.rootEl.style.setProperty("--puffs-anno-bg", annoBg);
    else this.rootEl.style.removeProperty("--puffs-anno-bg");
    if (chapterColor) this.rootEl.style.setProperty("--puffs-chapter-meta-color", chapterColor);
    else this.rootEl.style.removeProperty("--puffs-chapter-meta-color");
    if (progressColor) this.rootEl.style.setProperty("--puffs-progress-meta-color", progressColor);
    else this.rootEl.style.removeProperty("--puffs-progress-meta-color");
  }
  toggleTypography() {
    if (this.isTypographyOpen) this.closeTypography();
    else {
      this.isTypographyOpen = true;
      this.refreshTypographyPanel();
      this.typographyPanel.classList.remove("puffs-hidden");
    }
  }
  closeTypography() {
    this.isTypographyOpen = false;
    this.typographyPanel.classList.add("puffs-hidden");
  }
  closePanelsOnOutsideClick(e) {
    const target = e.target;
    if (!target) return;
    if (this.isTypographyOpen && !this.typographyPanel.contains(target) && !this.settingsBtn.contains(target)) {
      this.closeTypography();
    }
    if (this.isTocOpen && !this.tocSidebar.contains(target)) {
      this.closeSidebar();
    }
  }
  getBookSettings() {
    if (!this.currentFile) return {};
    return this.plugin.getBookSettings(this.currentFile.path);
  }
  getEffectiveFirstLineIndent() {
    var _a;
    return (_a = this.getBookSettings().firstLineIndent) != null ? _a : this.plugin.settings.firstLineIndent;
  }
  getEffectiveTocRegex() {
    var _a;
    return (_a = this.getBookSettings().tocRegex) != null ? _a : this.plugin.settings.tocRegex;
  }
  getEffectivePrologueTitleRegex() {
    var _a;
    return (_a = this.getBookSettings().prologueTitleRegex) != null ? _a : this.plugin.settings.prologueTitleRegex;
  }
  getEffectiveRemoveExtraBlankLines() {
    var _a;
    return (_a = this.getBookSettings().removeExtraBlankLines) != null ? _a : this.plugin.settings.removeExtraBlankLines;
  }
  getChapterMatchRegexes() {
    return [this.getEffectiveTocRegex(), this.getEffectivePrologueTitleRegex()].map((regexText) => regexText.trim()).filter((regexText) => regexText.length > 0).map((regexText) => new RegExp(regexText));
  }
  normalizeChapterNumber(raw) {
    if (/^\d+$/.test(raw)) return String(Number(raw));
    const parsed = this.parseChineseNumber(raw);
    return parsed > 0 ? String(parsed) : raw;
  }
  getChapterStartingAt(paraIndex) {
    var _a;
    return (_a = this.chapters.find((chapter) => chapter.startParaIndex === paraIndex)) != null ? _a : null;
  }
  parseChineseNumber(raw) {
    const digits = {
      \u96F6: 0,
      "\u3007": 0,
      \u4E00: 1,
      \u4E8C: 2,
      \u4E24: 2,
      \u4E09: 3,
      \u56DB: 4,
      \u4E94: 5,
      \u516D: 6,
      \u4E03: 7,
      \u516B: 8,
      \u4E5D: 9
    };
    const smallUnits = { \u5341: 10, \u767E: 100, \u5343: 1e3 };
    const largeUnits = { \u4E07: 1e4, \u4EBF: 1e8 };
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
  updateBookSettings(partial) {
    if (!this.currentFile) return;
    const next = {
      ...this.getBookSettings(),
      ...partial
    };
    this.plugin.saveBookSettings(this.currentFile.path, next);
  }
  // ═══════════════════════════ 书籍标签 ═══════════════════════════
  getBookTags() {
    if (!this.currentFile) return { genre: [], feature: [], accumulation: [] };
    return this.plugin.getBookTags(this.currentFile.path);
  }
  async saveBookTags(tags) {
    if (!this.currentFile) return;
    await this.plugin.saveBookTags(this.currentFile.path, tags);
    if (this.isTocOpen && this.sidebarMode === "tags") this.renderTagsPane();
  }
  renderTagsPane() {
    if (!this.tagsPaneEl) return;
    this.tagsPaneEl.empty();
    if (!this.currentFile) {
      this.tagsPaneEl.createDiv({ cls: "puffs-search-empty", text: "\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u4E66\u7C4D" });
      return;
    }
    const catalog = this.plugin.getTagCatalog();
    const tags = this.getBookTags();
    this.renderTagChipSection(
      this.tagsPaneEl,
      "\u9898\u6750",
      this.mergeTagOptions(catalog.genre, tags.genre),
      new Set(tags.genre),
      (tag) => this.toggleBookTag("genre", tag),
      "\u6DFB\u52A0\u9898\u6750",
      (value) => this.addCustomTag("genre", value)
    );
    this.renderTagChipSection(
      this.tagsPaneEl,
      "\u72B6\u6001",
      this.mergeTagOptions(catalog.status, tags.status ? [tags.status] : []),
      new Set(tags.status ? [tags.status] : []),
      (tag) => this.setBookStatusTag(tag),
      "\u6DFB\u52A0\u72B6\u6001",
      (value) => this.addCustomStatusTag(value)
    );
    this.renderTagChipSection(
      this.tagsPaneEl,
      "\u7279\u8272",
      this.mergeTagOptions(catalog.feature, tags.feature),
      new Set(tags.feature),
      (tag) => this.toggleBookTag("feature", tag),
      "\u6DFB\u52A0\u7279\u8272",
      (value) => this.addCustomTag("feature", value)
    );
    this.renderAccumulationTagSection(this.tagsPaneEl, catalog.feature, tags);
  }
  renderTagChipSection(parent, title, options, selected, onToggle, placeholder, onAdd) {
    const section = parent.createDiv({ cls: "puffs-tag-section" });
    section.createDiv({ cls: "puffs-tag-section-title", text: title });
    const chips = section.createDiv({ cls: "puffs-tag-chip-row" });
    for (const option of options) {
      const chip = chips.createEl("button", {
        cls: selected.has(option) ? "puffs-tag-chip is-active" : "puffs-tag-chip",
        text: option
      });
      chip.addEventListener("click", () => {
        Promise.resolve(onToggle(option)).catch((error) => console.error("[Puffs Reader] Failed to toggle tag:", error));
      });
    }
    this.renderCustomTagInput(section, placeholder, onAdd);
  }
  renderAccumulationTagSection(parent, options, tags) {
    const selected = new Set(tags.accumulation.map((tag) => tag.name));
    const section = parent.createDiv({ cls: "puffs-tag-section" });
    section.createDiv({ cls: "puffs-tag-section-title", text: "\u79EF\u7D2F\u60C5\u51B5" });
    const chips = section.createDiv({ cls: "puffs-tag-chip-row" });
    for (const option of this.mergeTagOptions(options, tags.accumulation.map((tag) => tag.name))) {
      const chip = chips.createEl("button", {
        cls: selected.has(option) ? "puffs-tag-chip is-active" : "puffs-tag-chip",
        text: option
      });
      chip.addEventListener("click", () => {
        this.toggleAccumulationTag(option).catch((error) => console.error("[Puffs Reader] Failed to toggle accumulation tag:", error));
      });
    }
    this.renderCustomTagInput(section, "\u6DFB\u52A0\u79EF\u7D2F\u9879", (value) => this.addCustomAccumulationTag(value));
    if (tags.accumulation.length === 0) {
      section.createDiv({ cls: "puffs-tag-empty", text: "\u672A\u9009\u62E9\u79EF\u7D2F\u9879" });
      return;
    }
    const list = section.createDiv({ cls: "puffs-tag-accumulation-list" });
    for (const item of tags.accumulation) {
      const row = list.createDiv({ cls: "puffs-tag-accumulation-row" });
      row.createSpan({ cls: "puffs-tag-accumulation-name", text: item.name });
      const startInput = row.createEl("input", {
        cls: "puffs-tag-range-input",
        attr: { type: "number", min: "1", step: "1", placeholder: "\u8D77" }
      });
      startInput.value = item.startChapter ? String(item.startChapter) : "";
      row.createSpan({ cls: "puffs-tag-range-separator", text: "-" });
      const endInput = row.createEl("input", {
        cls: "puffs-tag-range-input",
        attr: { type: "number", min: "1", step: "1", placeholder: "\u6B62" }
      });
      endInput.value = item.endChapter ? String(item.endChapter) : "";
      const saveRange = () => {
        this.updateAccumulationRange(item.name, startInput.value, endInput.value).catch((error) => console.error("[Puffs Reader] Failed to update accumulation range:", error));
      };
      startInput.addEventListener("change", saveRange);
      endInput.addEventListener("change", saveRange);
    }
  }
  renderCustomTagInput(parent, placeholder, onAdd) {
    const row = parent.createDiv({ cls: "puffs-tag-custom-row" });
    const input = row.createEl("input", {
      cls: "puffs-tag-custom-input",
      attr: { type: "text", placeholder }
    });
    const addBtn = row.createEl("button", { cls: "puffs-tag-add-btn", text: "\u6DFB\u52A0" });
    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      input.value = "";
      Promise.resolve(onAdd(value)).catch((error) => console.error("[Puffs Reader] Failed to add tag:", error));
    };
    addBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submit();
    });
  }
  mergeTagOptions(base, extra) {
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const value of [...base, ...extra]) {
      const tag = this.normalizeTagName(value);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
    }
    return result;
  }
  normalizeTagName(value) {
    return value.trim();
  }
  normalizeAccumulationTagName(value) {
    return this.normalizeTagName(value).replace(/^已积累/, "").trim();
  }
  async addCustomTag(group, rawValue) {
    const value = await this.plugin.addTagCatalogItem(group, rawValue);
    if (!value) return;
    await this.addBookTag(group, value);
  }
  async addCustomStatusTag(rawValue) {
    const value = await this.plugin.addTagCatalogItem("status", rawValue);
    if (!value) return;
    await this.setBookStatusTag(value);
  }
  async addCustomAccumulationTag(rawValue) {
    const value = await this.plugin.addTagCatalogItem("feature", this.normalizeAccumulationTagName(rawValue));
    if (!value) return;
    const tags = this.getBookTags();
    if (!tags.accumulation.some((tag) => tag.name === value)) {
      await this.saveBookTags({
        ...tags,
        accumulation: [...tags.accumulation, { name: value }]
      });
    } else {
      this.renderTagsPane();
    }
  }
  async addBookTag(group, tag) {
    const tags = this.getBookTags();
    const current = tags[group];
    if (current.includes(tag)) {
      this.renderTagsPane();
      return;
    }
    await this.saveBookTags({ ...tags, [group]: [...current, tag] });
  }
  async toggleBookTag(group, tag) {
    const tags = this.getBookTags();
    const selected = new Set(tags[group]);
    if (selected.has(tag)) selected.delete(tag);
    else selected.add(tag);
    await this.saveBookTags({ ...tags, [group]: Array.from(selected) });
  }
  async setBookStatusTag(tag) {
    const tags = this.getBookTags();
    await this.saveBookTags({
      ...tags,
      status: tags.status === tag ? void 0 : tag
    });
  }
  async toggleAccumulationTag(tag) {
    const tags = this.getBookTags();
    const exists = tags.accumulation.some((item) => item.name === tag);
    await this.saveBookTags({
      ...tags,
      accumulation: exists ? tags.accumulation.filter((item) => item.name !== tag) : [...tags.accumulation, { name: tag }]
    });
  }
  async updateAccumulationRange(name, rawStart, rawEnd) {
    const startChapter = this.parseOptionalChapter(rawStart);
    const endChapter = this.parseOptionalChapter(rawEnd);
    if (startChapter === null || endChapter === null) {
      new import_obsidian.Notice("\u7AE0\u8282\u8303\u56F4\u5FC5\u987B\u662F\u6B63\u6574\u6570");
      this.renderTagsPane();
      return;
    }
    if (startChapter !== void 0 && endChapter !== void 0 && endChapter < startChapter) {
      new import_obsidian.Notice("\u7ED3\u675F\u7AE0\u8282\u4E0D\u80FD\u5C0F\u4E8E\u8D77\u59CB\u7AE0\u8282");
      this.renderTagsPane();
      return;
    }
    const tags = this.getBookTags();
    await this.saveBookTags({
      ...tags,
      accumulation: tags.accumulation.map((item) => item.name === name ? {
        name: item.name,
        ...startChapter !== void 0 ? { startChapter } : {},
        ...endChapter !== void 0 ? { endChapter } : {}
      } : item)
    });
  }
  parseOptionalChapter(value) {
    const trimmed = value.trim();
    if (!trimmed) return void 0;
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  bindGlobalKeys() {
    this.boundGlobalKeydown = (e) => {
      if (!this.contentEl.isConnected) return;
      if (e.key === "Escape") {
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
    document.addEventListener("keydown", this.boundGlobalKeydown, true);
    window.addEventListener("keydown", this.boundGlobalKeydown, true);
  }
  bindCursorAutoHide() {
    this.boundMouseMove = () => {
      if (!this.contentEl.isConnected) return;
      this.resetCursorIdleState();
    };
    document.addEventListener("mousemove", this.boundMouseMove, true);
  }
  resetCursorIdleState() {
    this.showCursor();
    this.clearCursorHideTimer();
    if (!this.shouldAutoHideCursor()) return;
    this.cursorHideTimer = window.setTimeout(() => {
      var _a;
      if (this.shouldAutoHideCursor()) {
        (_a = this.rootEl) == null ? void 0 : _a.classList.add("puffs-cursor-hidden");
      }
    }, this.plugin.settings.cursorHideDelayMs);
  }
  shouldAutoHideCursor() {
    return this.app.workspace.activeLeaf === this.leaf && this.contentEl.isConnected && this.plugin.settings.cursorHideDelayMs > 0;
  }
  showCursor() {
    var _a;
    (_a = this.rootEl) == null ? void 0 : _a.classList.remove("puffs-cursor-hidden");
  }
  clearCursorHideTimer() {
    window.clearTimeout(this.cursorHideTimer);
    this.cursorHideTimer = 0;
  }
  matchesHotkey(e, raw) {
    const parts = raw.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
    const key = parts.find((p) => !["ctrl", "control", "cmd", "meta", "alt", "shift"].includes(p));
    if (!key) return false;
    const eventKey = e.key.toLowerCase();
    const eventCode = e.code.toLowerCase().replace(/^key/, "");
    return (eventKey === key || eventCode === key) && e.ctrlKey === (parts.includes("ctrl") || parts.includes("control")) && e.metaKey === (parts.includes("cmd") || parts.includes("meta")) && e.altKey === parts.includes("alt") && e.shiftKey === parts.includes("shift");
  }
  matchesSearchHotkey(e) {
    return this.matchesHotkey(e, this.plugin.settings.searchHotkey || "Ctrl+F");
  }
  matchesTocPanelHotkey(e) {
    return this.matchesHotkey(e, this.plugin.settings.tocPanelHotkey || "Ctrl+B");
  }
  matchesCopySourceHotkey(e) {
    return this.matchesHotkey(e, this.plugin.settings.copySourceHotkey || "Ctrl+Shift+C");
  }
  matchesPreviousPageHotkey(e) {
    return this.matchesHotkey(e, this.plugin.settings.previousPageHotkey || "j");
  }
  matchesNextPageHotkey(e) {
    return this.matchesHotkey(e, this.plugin.settings.nextPageHotkey || "l");
  }
  isEditableTarget(target) {
    return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
  }
  handleKeydown(e) {
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
    if (e.key === " " || e.code === "Space") {
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
    if (e.key === "ArrowRight" || this.matchesNextPageHotkey(e)) {
      e.preventDefault();
      this.tryManualPageTurn("next");
    } else if (e.key === "ArrowLeft" || this.matchesPreviousPageHotkey(e)) {
      e.preventDefault();
      this.tryManualPageTurn("previous");
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }
  handleKeyup(e) {
    if (e.key !== " " && e.code !== "Space") return;
    window.clearTimeout(this.spaceHoldTimer);
    const sel = this.spacePressedSelection;
    const fired = this.spaceHoldFired;
    this.spacePressedSelection = null;
    this.spaceHoldFired = false;
    if (sel && !fired) {
      e.preventDefault();
      this.addAnnotation(sel, void 0);
    }
  }
  isReaderKeyboardActive() {
    const active = document.activeElement;
    return this.app.workspace.activeLeaf === this.leaf || !!active && this.contentEl.contains(active);
  }
  shouldHandleSearchHotkey() {
    const active = document.activeElement;
    return this.app.workspace.activeLeaf === this.leaf && !!active && this.contentEl.contains(active);
  }
  shouldHandleCopySourceHotkey(e) {
    return this.app.workspace.activeLeaf === this.leaf && !this.isEditableTarget(e.target);
  }
  openChapterCopyModal() {
    if (this.chapterCopyModal) return;
    const choices = this.getCopyableChapterChoices();
    if (choices.length === 0) {
      new import_obsidian.Notice("\u672A\u68C0\u6D4B\u5230\u53EF\u590D\u5236\u7684\u7AE0\u8282");
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
      }
    );
    this.chapterCopyModal = modal;
    modal.open();
  }
  getCopyableChapterChoices() {
    const hasNestedToc = this.chapters.some((chapter) => chapter.level > 1);
    const choices = [];
    this.chapters.forEach((chapter, index) => {
      if (hasNestedToc && this.hasTocChildren(index)) return;
      choices.push({
        chapter,
        index,
        displayTitle: hasNestedToc ? this.getChapterPathTitle(index) : chapter.title
      });
    });
    return choices;
  }
  getInitialCopyChoiceIndex(choices, activeChapterIndex) {
    const exact = choices.findIndex((choice) => choice.index === activeChapterIndex);
    if (exact >= 0) return choices[exact].index;
    const next = choices.find((choice) => choice.index > activeChapterIndex);
    return (next != null ? next : choices[choices.length - 1]).index;
  }
  async splitChapterRanges(startIndex, endIndex, chunkSize) {
    const segments = chunkSize === null ? [[startIndex, endIndex]] : this.buildBatchChapterSegments(startIndex, endIndex, chunkSize);
    if (segments.length === 0) {
      new import_obsidian.Notice("\u62C6\u5206\u5931\u8D25\uFF1A\u7AE0\u8282\u8303\u56F4\u65E0\u6548");
      return false;
    }
    for (let i = 0; i < segments.length; i++) {
      const [segmentStart, segmentEnd] = segments[i];
      const text = this.getChapterRangeText(segmentStart, segmentEnd);
      if (text === null) return false;
      if (chunkSize === null && i === 0) {
        try {
          await navigator.clipboard.writeText(text);
        } catch (e) {
          new import_obsidian.Notice("\u590D\u5236\u5931\u8D25\uFF1A\u65E0\u6CD5\u5199\u5165\u526A\u8D34\u677F");
          return false;
        }
      }
      const ok = await this.writeChapterRangeText(segmentStart, segmentEnd, text);
      if (!ok) return false;
    }
    return true;
  }
  getChapterRangeWordCount(startIndex, endIndex) {
    const text = this.getChapterRangeText(startIndex, endIndex, false);
    return text === null ? null : text.replace(/\s+/g, "").length;
  }
  getFirstBatchChapterRangeWordCount(startIndex, endIndex, chunkSize) {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) return null;
    const first = this.buildBatchChapterSegments(startIndex, endIndex, chunkSize)[0];
    return first ? this.getChapterRangeWordCount(first[0], first[1]) : null;
  }
  getChapterRangeText(startIndex, endIndex, showNotice = true) {
    var _a, _b;
    const start = this.chapters[startIndex];
    const end = this.chapters[endIndex];
    if (!start || !end) {
      if (showNotice) new import_obsidian.Notice("\u590D\u5236\u5931\u8D25\uFF1A\u7AE0\u8282\u8303\u56F4\u65E0\u6548");
      return null;
    }
    if (endIndex < startIndex) {
      if (showNotice) new import_obsidian.Notice("\u7ED3\u675F\u7AE0\u8282\u4E0D\u80FD\u65E9\u4E8E\u8D77\u59CB\u7AE0\u8282");
      return null;
    }
    const endParaIndex = (_b = (_a = this.chapters[endIndex + 1]) == null ? void 0 : _a.startParaIndex) != null ? _b : this.paragraphs.length;
    return this.paragraphs.slice(start.startParaIndex, endParaIndex).join("\n");
  }
  buildBatchChapterSegments(startIndex, endIndex, chunkSize) {
    const choices = this.getCopyableChapterChoices().filter((choice) => choice.index >= startIndex && choice.index <= endIndex);
    const segments = [];
    let pos = 0;
    while (pos < choices.length) {
      const parentIndex = this.getChapterParentIndex(choices[pos].index);
      let groupEnd = pos;
      while (groupEnd + 1 < choices.length && this.getChapterParentIndex(choices[groupEnd + 1].index) === parentIndex) {
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
  async writeChapterRangeText(startIndex, endIndex, text) {
    if (!this.currentFile) {
      new import_obsidian.Notice("\u4FDD\u5B58\u5931\u8D25\uFF1A\u5F53\u524D\u4E66\u7C4D\u6587\u4EF6\u65E0\u6548");
      return false;
    }
    try {
      const baseDir = (this.plugin.settings.breakdownTextDir || DEFAULT_SETTINGS.breakdownTextDir).trim().replace(/^\/+|\/+$/g, "");
      const bookName = this.sanitizePathComponent(this.currentFile.basename);
      const targetDir = (0, import_obsidian.normalizePath)(baseDir ? `${baseDir}/${bookName}` : bookName);
      await this.ensureVaultFolder(targetDir);
      const fileName = this.buildChapterRangeFileName(bookName, startIndex, endIndex);
      await this.app.vault.adapter.write((0, import_obsidian.normalizePath)(`${targetDir}/${fileName}`), text);
      return true;
    } catch (e) {
      new import_obsidian.Notice("\u4FDD\u5B58\u5931\u8D25\uFF1A\u65E0\u6CD5\u521B\u5EFA\u62C6\u4E66\u6587\u672C\u6587\u4EF6");
      return false;
    }
  }
  buildChapterRangeFileName(bookName, startIndex, endIndex) {
    const parts = [bookName, ...this.getChapterRangeTitleParts(startIndex, endIndex)];
    return `${parts.map((part) => this.sanitizePathComponent(part)).join("-")}.txt`;
  }
  getChapterRangeTitleParts(startIndex, endIndex) {
    const startPath = this.getChapterPathTitles(startIndex);
    const endPath = this.getChapterPathTitles(endIndex);
    const startAncestors = startPath.slice(0, -1);
    const endAncestors = endPath.slice(0, -1);
    let commonAncestorCount = 0;
    while (commonAncestorCount < startAncestors.length && commonAncestorCount < endAncestors.length && startAncestors[commonAncestorCount] === endAncestors[commonAncestorCount]) {
      commonAncestorCount++;
    }
    return [
      ...startPath.slice(0, commonAncestorCount),
      ...startPath.slice(commonAncestorCount),
      ...endPath.slice(commonAncestorCount)
    ];
  }
  getChapterPathTitle(chapterIndex) {
    return this.getChapterPathTitles(chapterIndex).join("-");
  }
  getChapterPathTitles(chapterIndex) {
    return [...this.getChapterAncestorIndices(chapterIndex), chapterIndex].map((index) => {
      var _a;
      return (_a = this.chapters[index]) == null ? void 0 : _a.title;
    }).filter((title) => !!title);
  }
  getChapterAncestorIndices(chapterIndex) {
    const ancestors = [];
    let parentIndex = this.getChapterParentIndex(chapterIndex);
    while (parentIndex !== null) {
      ancestors.unshift(parentIndex);
      parentIndex = this.getChapterParentIndex(parentIndex);
    }
    return ancestors;
  }
  getChapterParentIndex(chapterIndex) {
    var _a, _b;
    const level = (_b = (_a = this.chapters[chapterIndex]) == null ? void 0 : _a.level) != null ? _b : 1;
    if (level <= 1) return null;
    for (let i = chapterIndex - 1; i >= 0; i--) {
      if (this.chapters[i].level < level) return i;
    }
    return null;
  }
  sanitizePathComponent(value) {
    const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim();
    return sanitized || "\u672A\u547D\u540D";
  }
  async ensureVaultFolder(folderPath) {
    const parts = (0, import_obsidian.normalizePath)(folderPath).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }
  scheduleProgressSave() {
    window.clearTimeout(this.progressSaveTimer);
    this.progressSaveTimer = window.setTimeout(() => this.saveProgressNow(), 800);
  }
  saveProgressNow() {
    if (!this.currentFile || this.paragraphs.length === 0) return;
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: this.currentPageStart.paraIndex,
      charOffset: this.currentPageStart.charOffset,
      lastRead: Date.now()
    });
  }
  buildHighlightedHTML(text, matches) {
    const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset);
    let result = "";
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
  escapeHTML(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // ═══════════════════════════ 标注 / 批注 ═══════════════════════════
  getAnnotations() {
    var _a;
    return (_a = this.getBookSettings().annotations) != null ? _a : [];
  }
  async setAnnotations(next) {
    if (!this.currentFile) return;
    const merged = { ...this.getBookSettings(), annotations: next };
    await this.plugin.saveBookSettings(this.currentFile.path, merged);
    if (this.isTocOpen && this.sidebarMode === "notes") {
      this.renderNotesPane();
    }
  }
  renderNotesPane() {
    if (!this.notesPaneEl) return;
    this.notesPaneEl.empty();
    const annos = [...this.getAnnotations()].map((a, idx) => ({ a, idx })).sort((x, y) => x.a.paraIndex - y.a.paraIndex || x.a.startOffset - y.a.startOffset);
    if (annos.length === 0) {
      this.notesPaneEl.createDiv({ cls: "puffs-search-empty", text: "\u5F53\u524D\u4E66\u6CA1\u6709\u6807\u6CE8\u6216\u6279\u6CE8" });
      return;
    }
    annos.forEach(({ a, idx }) => {
      const card = this.notesPaneEl.createDiv({ cls: "puffs-search-card puffs-note-card" });
      const head = card.createDiv({ cls: "puffs-note-card-head" });
      const chapter = this.getActiveChapterIndex(a.paraIndex);
      head.createDiv({
        cls: "puffs-search-card-title puffs-note-card-title",
        text: chapter >= 0 ? this.chapters[chapter].title : `\u7B2C ${a.paraIndex + 1} \u6BB5`
      });
      const closeBtn = head.createEl("button", {
        cls: "puffs-note-card-close",
        text: "\xD7",
        attr: { "aria-label": "\u5220\u9664" }
      });
      closeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const next = this.getAnnotations().filter((_, i) => i !== idx);
        await this.setAnnotations(next);
        this.renderCurrentPage();
      });
      if (a.note) {
        card.createDiv({ cls: "puffs-note-card-note", text: `\u6279\u6CE8\uFF1A${a.note}` });
      }
      const preview = card.createDiv({ cls: "puffs-search-card-preview puffs-note-card-preview" });
      this.renderAnnotationPreview(preview, a.text);
      card.addEventListener("click", () => {
        this.jumpToPosition({ paraIndex: a.paraIndex, charOffset: a.startOffset });
      });
    });
  }
  getAnnotationEnd(annotation) {
    if (Number.isFinite(annotation.endParaIndex) && Number.isFinite(annotation.endOffset) && annotation.endParaIndex !== void 0 && annotation.endOffset !== void 0) {
      return {
        paraIndex: annotation.endParaIndex,
        charOffset: annotation.endOffset
      };
    }
    return {
      paraIndex: annotation.paraIndex,
      charOffset: annotation.startOffset + annotation.length
    };
  }
  getAnnotationSegment(annotation, paraIndex) {
    var _a, _b;
    const end = this.getAnnotationEnd(annotation);
    if (paraIndex < annotation.paraIndex || paraIndex > end.paraIndex) return null;
    const paragraphLength = (_b = (_a = this.paragraphs[paraIndex]) == null ? void 0 : _a.length) != null ? _b : 0;
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
  captureSelection() {
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
    if (!Number.isFinite(paraIndex) || !Number.isFinite(endParaIndex) || !Number.isFinite(startBaseOffset) || !Number.isFinite(endBaseOffset)) return null;
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
      text
    };
  }
  getSelectedSearchText() {
    const selection = this.captureSelection();
    const text = selection == null ? void 0 : selection.text.replace(/\s+/g, " ").trim();
    return text || null;
  }
  buildAnnotationText(start, end) {
    var _a;
    const parts = [];
    for (let pi = start.paraIndex; pi <= end.paraIndex && pi < this.paragraphs.length; pi++) {
      const paragraph = (_a = this.paragraphs[pi]) != null ? _a : "";
      const begin = pi === start.paraIndex ? start.charOffset : 0;
      const finish = pi === end.paraIndex ? end.charOffset : paragraph.length;
      parts.push(paragraph.slice(begin, finish));
    }
    return parts.join("\n");
  }
  clampAnnotationPosition(paraIndex, charOffset) {
    var _a, _b;
    const nextParaIndex = Math.max(0, Math.min(paraIndex, Math.max(0, this.paragraphs.length - 1)));
    const paragraphLength = (_b = (_a = this.paragraphs[nextParaIndex]) == null ? void 0 : _a.length) != null ? _b : 0;
    return {
      paraIndex: nextParaIndex,
      charOffset: Math.max(0, Math.min(charOffset, paragraphLength))
    };
  }
  findParaElement(node) {
    let cur = node;
    while (cur && cur !== this.contentContainer) {
      if (cur.nodeType === Node.ELEMENT_NODE) {
        const el = cur;
        if (el.classList.contains("puffs-para")) return el;
      }
      cur = cur.parentNode;
    }
    return null;
  }
  /** 把 (node, offset) 在 paragraph 内换算为纯文本偏移。 */
  nodeOffsetToTextOffset(para, node, offset) {
    let total = Number(para.dataset.leadingIndentLength) || 0;
    const walk = (current) => {
      var _a, _b;
      if (current === node) {
        if (current.nodeType === Node.TEXT_NODE) {
          total += offset;
        } else {
          for (let i = 0; i < offset && i < current.childNodes.length; i++) {
            total += ((_a = current.childNodes[i].textContent) != null ? _a : "").length;
          }
        }
        return true;
      }
      if (current.nodeType === Node.TEXT_NODE) {
        total += ((_b = current.textContent) != null ? _b : "").length;
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
  async addAnnotation(sel, note) {
    var _a;
    const next = [...this.getAnnotations()];
    next.push({
      paraIndex: sel.paraIndex,
      startOffset: sel.startOffset,
      length: sel.length,
      endParaIndex: sel.endParaIndex,
      endOffset: sel.endOffset,
      text: sel.text,
      note: note && note.trim() ? note.trim() : void 0,
      createdAt: Date.now()
    });
    await this.setAnnotations(next);
    (_a = window.getSelection()) == null ? void 0 : _a.removeAllRanges();
    this.renderCurrentPage();
  }
  openAnnotationModal(sel) {
    new AnnotationInputModal(this.app, sel.text, (note) => {
      this.addAnnotation(sel, note);
    }).open();
  }
  handleAnnotationContextMenu(e) {
    var _a, _b;
    const target = (_b = (_a = e.target) == null ? void 0 : _a.closest) == null ? void 0 : _b.call(_a, ".puffs-annotation");
    if (!target) return;
    const idx = Number(target.dataset.annoIdx);
    if (!Number.isFinite(idx)) return;
    const annos = this.getAnnotations();
    const anno = annos[idx];
    if (!anno) return;
    e.preventDefault();
    const menu = new import_obsidian.Menu();
    if (anno.note) {
      menu.addItem(
        (item) => item.setTitle(`\u6279\u6CE8: ${anno.note}`).setIcon("message-square").setDisabled(true)
      );
      menu.addSeparator();
    }
    menu.addItem(
      (item) => item.setTitle("\u5220\u9664").setIcon("trash").onClick(async () => {
        const next = annos.filter((_, i) => i !== idx);
        await this.setAnnotations(next);
        this.renderCurrentPage();
      })
    );
    menu.showAtMouseEvent(e);
  }
  async exportAnnotations() {
    var _a;
    if (!this.currentFile) return;
    const annos = [...this.getAnnotations()].sort(
      (a, b) => a.paraIndex - b.paraIndex || a.startOffset - b.startOffset
    );
    if (annos.length === 0) {
      new import_obsidian.Notice("\u5F53\u524D\u4E66\u6CA1\u6709\u6807\u6CE8");
      return;
    }
    const basename = this.currentFile.basename;
    const blocks = annos.map((a) => {
      const lines = [];
      if (a.note) lines.push(`\u6279\u6CE8\uFF1A${a.note}`);
      lines.push(this.formatAnnotationText(a.text));
      return lines.join("\n");
    });
    const markdown = blocks.join("\n\n") + "\n";
    const dir = ((_a = this.plugin.settings.annotationExportDir) != null ? _a : "").trim().replace(/^\/+|\/+$/g, "");
    if (dir) {
      try {
        await this.app.vault.createFolder(dir);
      } catch (e) {
      }
    }
    const targetPath = await this.findAvailableExportPath(dir, `${basename}-\u7B14\u8BB0`);
    await this.app.vault.adapter.write(targetPath, markdown);
    if (this.plugin.settings.deleteAnnotationsAfterExport) {
      await this.setAnnotations([]);
      this.renderCurrentPage();
      new import_obsidian.Notice(`\u5DF2\u5BFC\u51FA ${annos.length} \u6761\u5230 ${targetPath}\uFF0C\u5E76\u5220\u9664\u5BF9\u5E94\u6807\u6CE8\u4E0E\u6279\u6CE8`);
      return;
    }
    new import_obsidian.Notice(`\u5DF2\u5BFC\u51FA ${annos.length} \u6761\u5230 ${targetPath}`);
  }
  renderAnnotationPreview(container, text) {
    container.empty();
    const paragraphs = this.formatAnnotationText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (paragraphs.length === 0) {
      container.textContent = "";
      return;
    }
    for (const paragraph of paragraphs) {
      container.createDiv({ cls: "puffs-note-card-paragraph", text: paragraph });
    }
  }
  formatAnnotationText(text) {
    return text.split(/\r?\n/).map((line) => line.replace(/^[\s\u3000]+/, "")).join("\n");
  }
  /** 在目录里寻找一个未占用的 md 文件名；同名时追加 `-2`、`-3` ... */
  async findAvailableExportPath(dir, baseName) {
    const prefix = dir ? dir + "/" : "";
    const first = `${prefix}${baseName}.md`;
    if (!await this.app.vault.adapter.exists(first)) return first;
    for (let i = 2; i < 1e3; i++) {
      const candidate = `${prefix}${baseName}-${i}.md`;
      if (!await this.app.vault.adapter.exists(candidate)) return candidate;
    }
    return `${prefix}${baseName}-${Date.now()}.md`;
  }
};
function normalizeChapterSearchText(value) {
  return value.trim().toLowerCase();
}
function parseChapterSearchNumber(raw) {
  const text = raw.trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  const digits = {
    \u96F6: 0,
    "\u3007": 0,
    \u4E00: 1,
    \u4E8C: 2,
    \u4E24: 2,
    \u4E09: 3,
    \u56DB: 4,
    \u4E94: 5,
    \u516D: 6,
    \u4E03: 7,
    \u516B: 8,
    \u4E5D: 9
  };
  const smallUnits = { \u5341: 10, \u767E: 100, \u5343: 1e3 };
  const largeUnits = { \u4E07: 1e4, \u4EBF: 1e8 };
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
function normalizeChapterSearchNumber(raw) {
  const normalized = raw.trim();
  if (!normalized) return null;
  const parsed = parseChapterSearchNumber(normalized);
  if (parsed > 0 || /^0+$/.test(normalized)) return String(parsed);
  return null;
}
function getChapterSearchNumberTokens(text) {
  const result = /* @__PURE__ */ new Set();
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
function buildChapterSearchCandidate(choice) {
  const title = normalizeChapterSearchText(choice.displayTitle);
  const rawTitle = normalizeChapterSearchText(choice.chapter.rawTitle);
  return {
    choice,
    textTargets: [title, rawTitle],
    numberTargets: getChapterSearchNumberTokens(`${choice.displayTitle} ${choice.chapter.rawTitle}`)
  };
}
function getChapterSearchRank(candidate, query, numericQuery) {
  if (numericQuery) {
    if (candidate.numberTargets.some((target) => target === numericQuery)) return 0;
    if (candidate.numberTargets.some((target) => target.startsWith(numericQuery))) return 1;
    if (candidate.numberTargets.some((target) => target.includes(numericQuery))) return 2;
  }
  if (candidate.textTargets.some((target) => target.includes(query))) return numericQuery ? 3 : 0;
  return Number.POSITIVE_INFINITY;
}
function getChapterSuggestions(candidates, preferredIndex, query) {
  const normalized = query.trim();
  if (!normalized) {
    return [...candidates].sort((a, b) => {
      if (a.choice.index === preferredIndex) return -1;
      if (b.choice.index === preferredIndex) return 1;
      return a.choice.index - b.choice.index;
    }).slice(0, 100).map((candidate) => candidate.choice);
  }
  const textQuery = normalizeChapterSearchText(normalized);
  const numericQuery = normalizeChapterSearchNumber(normalized);
  return candidates.map((candidate) => ({
    candidate,
    rank: getChapterSearchRank(candidate, textQuery, numericQuery)
  })).filter((item) => Number.isFinite(item.rank)).sort((a, b) => a.rank - b.rank || a.candidate.choice.index - b.candidate.choice.index).slice(0, 100).map((item) => item.candidate.choice);
}
var ChapterInputSuggest = class extends import_obsidian.AbstractInputSuggest {
  constructor(app, inputEl, choices, preferredIndex) {
    super(app, inputEl);
    this.candidates = choices.map((choice) => buildChapterSearchCandidate(choice));
    this.preferredIndex = preferredIndex;
    this.limit = 100;
  }
  setPreferredIndex(index) {
    this.preferredIndex = index;
  }
  getSuggestions(query) {
    return getChapterSuggestions(this.candidates, this.preferredIndex, query);
  }
  renderSuggestion(choice, el) {
    el.createDiv({ cls: "puffs-chapter-copy-suggestion", text: choice.displayTitle });
  }
};
var ChapterRangeCopyModal = class extends import_obsidian.Modal {
  constructor(app, choices, initialChapterIndex, onPreview, onBatchPreview, onSplit, onDismiss) {
    var _a;
    super(app);
    this.suggests = [];
    this.activeSuggest = null;
    this.choices = choices;
    this.onPreview = onPreview;
    this.onBatchPreview = onBatchPreview;
    this.onSplit = onSplit;
    this.onDismiss = onDismiss;
    this.batchStart = (_a = choices.find((choice) => choice.index === initialChapterIndex)) != null ? _a : choices[0];
    this.batchEnd = choices[choices.length - 1];
  }
  onOpen() {
    this.modalEl.addClass("puffs-chapter-copy-modal");
    this.renderSplitForm();
  }
  renderHeader(title) {
    const header = this.contentEl.createDiv({ cls: "puffs-chapter-copy-head" });
    header.createEl("h3", { cls: "puffs-chapter-copy-title", text: title });
  }
  renderSplitForm() {
    this.contentEl.empty();
    this.renderHeader("\u62C6\u5206\u6587\u672C");
    const startInput = this.createLabeledInput("\u8D77\u59CB\u7AE0\u8282", this.getChoiceDisplayText(this.batchStart));
    const endInput = this.createLabeledInput("\u7ED3\u675F\u7AE0\u8282", this.getChoiceDisplayText(this.batchEnd));
    this.chunkInput = this.createLabeledInput("\u6BCF\u4EFD\u51E0\u7AE0", "", "number");
    this.chunkInput.min = "1";
    this.chunkInput.step = "1";
    this.estimateInput = this.createLabeledInput("\u9884\u8BA1\u5B57\u6570", "", "text");
    this.estimateInput.readOnly = true;
    const refreshEstimate = () => {
      const chunkSize = this.parseChunkSize(false);
      const count = chunkSize === void 0 ? null : chunkSize === null ? this.onPreview(this.batchStart.index, this.batchEnd.index) : this.onBatchPreview(this.batchStart.index, this.batchEnd.index, chunkSize);
      this.estimateInput.value = count === null ? "" : String(count);
    };
    this.createSuggest(startInput, () => this.batchStart, (choice) => {
      if (choice.index > this.batchEnd.index) {
        new import_obsidian.Notice("\u8D77\u59CB\u7AE0\u8282\u4E0D\u80FD\u665A\u4E8E\u7ED3\u675F\u7AE0\u8282");
        return false;
      }
      this.batchStart = choice;
      startInput.value = this.getChoiceDisplayText(choice);
      refreshEstimate();
      return true;
    });
    this.createSuggest(endInput, () => this.batchEnd, (choice) => {
      if (choice.index < this.batchStart.index) {
        new import_obsidian.Notice("\u7ED3\u675F\u7AE0\u8282\u4E0D\u80FD\u65E9\u4E8E\u8D77\u59CB\u7AE0\u8282");
        return false;
      }
      this.batchEnd = choice;
      endInput.value = this.getChoiceDisplayText(choice);
      refreshEstimate();
      return true;
    });
    this.chunkInput.addEventListener("input", refreshEstimate);
    for (const input of [startInput, endInput, this.chunkInput]) {
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        if ((input === startInput || input === endInput) && this.activeSuggest) return;
        e.preventDefault();
        void this.confirmSplit(this.chunkInput);
      });
    }
    refreshEstimate();
    window.setTimeout(() => this.chunkInput.focus(), 0);
  }
  createLabeledInput(label, value, type = "text") {
    const row = this.contentEl.createDiv({ cls: "puffs-chapter-copy-row" });
    row.createSpan({ cls: "puffs-chapter-copy-label", text: label });
    const input = row.createEl("input", {
      cls: "puffs-chapter-copy-input",
      attr: { type, autocomplete: "off" }
    });
    input.value = value;
    return input;
  }
  createSuggest(input, getCurrentChoice, onSelect) {
    const suggest = new ChapterInputSuggest(this.app, input, this.choices, getCurrentChoice().index);
    suggest.onSelect((choice) => {
      if (!onSelect(choice)) return;
      input.value = this.getChoiceDisplayText(choice);
      suggest.close();
      if (this.activeSuggest === suggest) this.activeSuggest = null;
    });
    input.addEventListener("click", () => {
      suggest.setPreferredIndex(getCurrentChoice().index);
      suggest.setValue(input.value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      this.activeSuggest = suggest;
      suggest.open();
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!input.value) input.value = this.getChoiceDisplayText(getCurrentChoice());
        suggest.close();
        if (this.activeSuggest === suggest) this.activeSuggest = null;
      }, 120);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.activeSuggest === suggest) {
        e.preventDefault();
        e.stopImmediatePropagation();
        input.value = this.getChoiceDisplayText(getCurrentChoice());
        suggest.close();
        this.activeSuggest = null;
      }
    });
    this.suggests.push(suggest);
  }
  async confirmSplit(input) {
    const chunkSize = this.parseChunkSize(true);
    if (chunkSize === void 0) {
      input.focus();
      return;
    }
    const copied = await this.onSplit(this.batchStart.index, this.batchEnd.index, chunkSize);
    if (copied) this.close();
    else input.focus();
  }
  parseChunkSize(showNotice) {
    const raw = this.chunkInput.value.trim();
    if (!raw) return null;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) return value;
    if (showNotice) new import_obsidian.Notice("\u6BCF\u4EFD\u51E0\u7AE0\u5FC5\u987B\u662F\u6B63\u6574\u6570\uFF0C\u6216\u7559\u7A7A\u8868\u793A\u62C6\u6210\u4E00\u4EFD\u6587\u672C");
    return void 0;
  }
  getChoiceDisplayText(choice) {
    return choice.displayTitle;
  }
  onClose() {
    for (const suggest of this.suggests) suggest.close();
    this.suggests = [];
    this.activeSuggest = null;
    this.contentEl.empty();
    this.onDismiss();
  }
};
var AnnotationInputModal = class extends import_obsidian.Modal {
  constructor(app, defaultText, onSubmit) {
    super(app);
    this.defaultText = defaultText;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass("puffs-anno-modal");
    contentEl.createEl("h3", { cls: "puffs-anno-modal-title", text: "\u6DFB\u52A0\u6279\u6CE8" });
    const preview = contentEl.createDiv({ cls: "puffs-anno-modal-preview" });
    preview.textContent = this.defaultText;
    const input = contentEl.createEl("input", {
      cls: "puffs-anno-modal-input",
      attr: { type: "text", placeholder: "\u8F93\u5165\u6279\u6CE8\u5185\u5BB9\uFF0C\u56DE\u8F66\u4FDD\u5B58" }
    });
    setTimeout(() => input.focus(), 0);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = input.value;
        this.close();
        this.onSubmit(value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if ((e.key === " " || e.code === "Space") && input.value.length === 0) {
        e.preventDefault();
      }
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/SettingsTab.ts
var import_obsidian2 = require("obsidian");
var SettingsTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "\u6392\u7248\u8BBE\u7F6E" });
    this.addNumberSetting("\u6B63\u6587\u5B57\u4F53\u5927\u5C0F", "\u9605\u8BFB\u533A\u6587\u5B57\u5927\u5C0F (px)", "fontSize", 12, 36, 1, "px");
    this.addNumberSetting("\u884C\u95F4\u8DDD", "\u6B63\u6587\u884C\u95F4\u8DDD\u500D\u6570", "lineHeight", 1, 3.2, 0.1, "\u500D");
    this.addNumberSetting("\u6BB5\u843D\u95F4\u8DDD", "\u6BB5\u843D\u4E4B\u95F4\u7684\u8DDD\u79BB (px)", "paragraphSpacing", 0, 48, 1, "px");
    this.addNumberSetting("\u9996\u884C\u7F29\u8FDB", "\u6240\u6709\u4E66\u7C4D\u9ED8\u8BA4\u9996\u884C\u7F29\u8FDB (em)\uFF0C\u5355\u4E66\u8BBE\u7F6E\u53EF\u8986\u5199", "firstLineIndent", 0, 4, 0.1, "em");
    this.addNumberSetting("\u9605\u8BFB\u533A\u5BBD\u5EA6", "\u9605\u8BFB\u533A\u6700\u5927\u5BBD\u5EA6 (px)", "contentWidth", 360, 1500, 10, "px");
    this.addNumberSetting("\u5B57\u95F4\u8DDD", "\u6587\u5B57\u4E4B\u95F4\u7684\u8DDD\u79BB (px)", "letterSpacing", 0, 8, 0.1, "px");
    this.addNumberSetting("\u6B63\u6587\u9876\u90E8\u95F4\u8DDD", "\u6B63\u6587\u5185\u5BB9\u4E0E\u9875\u9762\u9876\u90E8\u7684\u8DDD\u79BB (px)", "paddingTop", 0, 180, 1, "px");
    this.addNumberSetting("\u6B63\u6587\u5E95\u90E8\u95F4\u8DDD", "\u6B63\u6587\u5185\u5BB9\u4E0E\u9875\u9762\u5E95\u90E8\u7684\u8DDD\u79BB (px)", "paddingBottom", 0, 200, 1, "px");
    this.addNumberSetting("\u5DE6\u4FA7\u680F\u5BBD\u5EA6", "\u76EE\u5F55\u548C\u5168\u6587\u641C\u7D22\u4FA7\u680F\u5BBD\u5EA6 (px)", "sidebarWidth", 220, 520, 1, "px");
    this.addNumberSetting("\u4FA7\u680F\u8FC7\u6E21\u901F\u5EA6", "\u76EE\u5F55\u548C\u5168\u6587\u641C\u7D22\u4FA7\u680F\u5C55\u5F00/\u6536\u8D77\u52A8\u753B\u65F6\u957F (ms)", "sidebarTransitionMs", 0, 800, 10, "ms");
    this.addNumberSetting("\u76EE\u5F55\u5B57\u4F53\u5927\u5C0F", "\u5DE6\u4FA7\u76EE\u5F55\u6761\u76EE\u7684\u5B57\u4F53\u5927\u5C0F (px)", "tocFontSize", 11, 20, 1, "px");
    this.addNumberSetting("\u4FA7\u680F\u4E66\u540D\u5B57\u53F7", "\u4FA7\u8FB9\u680F\u9876\u90E8\u4E66\u540D\u7684\u5B57\u53F7 (px)", "sidebarTitleFontSize", 11, 28, 1, "px");
    this.addTextSetting("\u5B57\u4F53\u989C\u8272", "RGB \u683C\u5F0F\uFF0C\u5982 51,51,51\u3002\u7559\u7A7A\u8DDF\u968F\u4E3B\u9898\u3002", "fontColor", "\u4F8B\u5982 51,51,51");
    this.addTextSetting("\u4E66\u7C4D\u80CC\u666F\u989C\u8272", "RGB \u683C\u5F0F\uFF0C\u5982 233,216,188\u3002\u7559\u7A7A\u8DDF\u968F\u4E3B\u9898\u3002", "backgroundColor", "\u4F8B\u5982 233,216,188");
    containerEl.createEl("h3", { text: "\u9876\u90E8\u7AE0\u540D\u4E0E\u5E95\u90E8\u8FDB\u5EA6" });
    this.addNumberSetting("\u7AE0\u540D\u5B57\u53F7", "\u9875\u9762\u9876\u90E8\u7AE0\u540D\u5C0F\u5B57\u5927\u5C0F (px)", "chapterMetaFontSize", 9, 20, 1, "px");
    this.addNumberSetting("\u7AE0\u540D\u9876\u90E8\u4F4D\u7F6E", "\u7AE0\u540D\u8DDD\u79BB\u9875\u9762\u9876\u90E8\u7684\u4F4D\u7F6E (px)", "chapterMetaTop", 0, 80, 1, "px");
    this.addTextSetting("\u7AE0\u540D\u989C\u8272", "RGB \u683C\u5F0F\uFF1B\u7559\u7A7A\u4F7F\u7528\u4E3B\u9898\u5F31\u5316\u6587\u5B57\u989C\u8272\u3002", "chapterMetaColor", "\u4F8B\u5982 120,120,120");
    this.addNumberSetting("\u8FDB\u5EA6\u5B57\u53F7", "\u9875\u9762\u5E95\u90E8\u767E\u5206\u6BD4\u5C0F\u5B57\u5927\u5C0F (px)", "progressMetaFontSize", 9, 20, 1, "px");
    this.addNumberSetting("\u8FDB\u5EA6\u5E95\u90E8\u4F4D\u7F6E", "\u767E\u5206\u6BD4\u8DDD\u79BB\u9875\u9762\u5E95\u90E8\u7684\u4F4D\u7F6E (px)", "progressMetaBottom", 0, 80, 1, "px");
    this.addTextSetting("\u8FDB\u5EA6\u989C\u8272", "RGB \u683C\u5F0F\uFF1B\u7559\u7A7A\u4F7F\u7528\u4E3B\u9898\u5F31\u5316\u6587\u5B57\u989C\u8272\u3002", "progressMetaColor", "\u4F8B\u5982 120,120,120");
    containerEl.createEl("h3", { text: "\u529F\u80FD\u5F00\u5173" });
    new import_obsidian2.Setting(containerEl).setName("\u663E\u793A\u9605\u8BFB\u8FDB\u5EA6").setDesc("\u5728\u9875\u9762\u5E95\u90E8\u663E\u793A\u9605\u8BFB\u767E\u5206\u6BD4").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showProgress).onChange(async (v) => {
        this.plugin.settings.showProgress = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u663E\u793A\u9876\u90E8\u7AE0\u540D").setDesc("\u5728\u9605\u8BFB\u533A\u9876\u90E8\u663E\u793A\u5F53\u524D\u7AE0\u8282\u540D").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showChapterTitle).onChange(async (v) => {
        this.plugin.settings.showChapterTitle = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u53BB\u9664\u591A\u4F59\u7A7A\u884C").setDesc("\u81EA\u52A8\u6E05\u7406 TXT \u4E2D\u8FDE\u7EED\u7684\u7A7A\u767D\u884C").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.removeExtraBlankLines).onChange(async (v) => {
        this.plugin.settings.removeExtraBlankLines = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    this.addNumberSetting("\u9F20\u6807\u9690\u85CF\u5EF6\u8FDF", "\u9605\u8BFB\u5668\u6807\u7B7E\u9875\u6FC0\u6D3B\u65F6\uFF0C\u9F20\u6807\u9759\u6B62\u591A\u4E45\u540E\u9690\u85CF\u5149\u6807\u3002\u8BBE\u4E3A 0 \u5219\u4E0D\u81EA\u52A8\u9690\u85CF\u3002", "cursorHideDelayMs", 0, 1e4, 100, "ms");
    this.addNumberSetting("\u6BCF\u79D2\u624B\u52A8\u7FFB\u9875\u901F\u5EA6\u4E0A\u9650", "\u6309\u952E\u76D8\u65B9\u5411\u952E\u7FFB\u9875\u65F6\uFF0C\u6BCF\u79D2\u6700\u591A\u5141\u8BB8\u7FFB\u8FC7\u7684\u9875\u6570\u3002", "manualPageTurnsPerSecond", 1, 20, 1, "\u9875/\u79D2");
    containerEl.createEl("h3", { text: "\u9605\u8BFB\u7EDF\u8BA1" });
    this.addNumberSetting(
      "\u8BA1\u5165\u5DF2\u8BFB\u505C\u7559\u65F6\u95F4",
      "\u9875\u9762\u81F3\u5C11\u505C\u7559\u591A\u4E45\u540E\uFF0C\u624D\u8BA1\u5165\u5DF2\u8BFB\u5B57\u6570\u548C\u5DF2\u8BFB\u7AE0\u8282\u3002",
      "readingStatsMinPageMs",
      100,
      6e4,
      100,
      "ms"
    );
    this.addNumberSettingInMinutes(
      "\u9605\u8BFB\u8BA1\u65F6\u7A7A\u95F2\u622A\u6B62",
      "\u5728\u540C\u4E00\u9875\u505C\u7559\u8D85\u8FC7\u591A\u4E45\u540E\uFF0C\u505C\u6B62\u7EE7\u7EED\u7D2F\u8BA1\u9605\u8BFB\u65F6\u957F\uFF0C\u76F4\u5230\u4E0B\u4E00\u6B21\u7FFB\u9875\u6216\u8DF3\u8F6C\u3002",
      "readingStatsIdleLimitMs",
      1,
      60,
      1,
      "min"
    );
    containerEl.createEl("h3", { text: "\u76EE\u5F55\u4E0E\u7F16\u7801" });
    this.addTextSetting("\u76EE\u5F55\u5339\u914D\u6B63\u5219", "\u6240\u6709\u4E66\u7C4D\u9ED8\u8BA4\u7AE0\u8282\u5339\u914D\u6B63\u5219\uFF1B\u5355\u4E66\u8BBE\u7F6E\u53EF\u8986\u5199\u3002", "tocRegex", DEFAULT_SETTINGS.tocRegex);
    this.addTextSetting("\u7AE0\u540D\u63D0\u53D6\u6B63\u5219", "\u4ECE\u7AE0\u8282\u884C\u4E2D\u63D0\u53D6\u663E\u793A\u6807\u9898\u7684\u6B63\u5219\uFF08\u9700\u542B\u6355\u83B7\u7EC4\uFF09\uFF1B\u5355\u4E66\u8BBE\u7F6E\u53EF\u8986\u5199\u3002", "chapterTitleRegex", DEFAULT_SETTINGS.chapterTitleRegex);
    this.addTextSetting("\u5E8F\u7AE0\u5339\u914D\u540D\u79F0", "\u5339\u914D\u5E8F\u7AE0\u3001\u524D\u8A00\u3001\u6954\u5B50\u7B49\u4E0D\u5E26\u201C\u7B2C\u51E0\u7AE0\u201D\u7684\u6807\u9898\uFF1B\u5355\u4E66\u8BBE\u7F6E\u53EF\u8986\u5199\u3002", "prologueTitleRegex", DEFAULT_SETTINGS.prologueTitleRegex);
    new import_obsidian2.Setting(containerEl).setName("\u9ED8\u8BA4\u7F16\u7801").setDesc("\u6253\u5F00\u6587\u4EF6\u65F6\u7684\u9ED8\u8BA4\u7F16\u7801\uFF08\u81EA\u52A8\u68C0\u6D4B\u5931\u8D25\u65F6\u4F7F\u7528\uFF09").addDropdown(
      (dd) => dd.addOptions({
        "utf-8": "UTF-8",
        gbk: "GBK",
        gb18030: "GB18030",
        big5: "Big5"
      }).setValue(this.plugin.settings.defaultEncoding).onChange(async (v) => {
        this.plugin.settings.defaultEncoding = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    this.addTextSetting(
      "\u5168\u6587\u641C\u7D22\u5FEB\u6377\u952E",
      "\u9ED8\u8BA4 Ctrl+F\u3002\u652F\u6301 Ctrl/Alt/Shift \u52A0\u5355\u4E2A\u6309\u952E\uFF0C\u4F8B\u5982 Ctrl+Shift+F\u3002",
      "searchHotkey",
      DEFAULT_SETTINGS.searchHotkey
    );
    this.addTextSetting(
      "\u76EE\u5F55\u9762\u677F\u5FEB\u6377\u952E",
      "\u9ED8\u8BA4 Ctrl+B\u3002\u7528\u4E8E\u5F39\u51FA/\u6536\u8D77\u5DE6\u4FA7\u76EE\u5F55\u4FA7\u8FB9\u680F\u3002",
      "tocPanelHotkey",
      DEFAULT_SETTINGS.tocPanelHotkey
    );
    this.addTextSetting(
      "\u62C6\u5206\u6587\u672C\u5FEB\u6377\u952E",
      "\u9ED8\u8BA4 Ctrl+Shift+C\u3002\u9009\u62E9\u8D77\u6B62\u7AE0\u8282\u540E\uFF0C\u5C06\u5BF9\u5E94\u539F\u6587\u62C6\u5206\u5E76\u4FDD\u5B58\u4E3A TXT \u6587\u4EF6\u3002",
      "copySourceHotkey",
      DEFAULT_SETTINGS.copySourceHotkey
    );
    this.addTextSetting(
      "\u62C6\u4E66\u6587\u672C\u76EE\u5F55",
      "vault \u5185\u76F8\u5BF9\u8DEF\u5F84\u3002\u590D\u5236\u7AE0\u8282\u539F\u6587\u65F6\uFF0C\u4F1A\u6309\u4E66\u540D\u521B\u5EFA\u5B50\u6587\u4EF6\u5939\u5E76\u4FDD\u5B58 TXT \u6587\u4EF6\u3002",
      "breakdownTextDir",
      DEFAULT_SETTINGS.breakdownTextDir
    );
    this.addTextSetting(
      "\u4E0A\u4E00\u9875\u5FEB\u6377\u952E",
      "\u9ED8\u8BA4 j\u3002\u9664\u5DE6\u65B9\u5411\u952E\u5916\uFF0C\u7528\u4E8E\u5411\u524D\u7FFB\u9875\u7684\u81EA\u5B9A\u4E49\u6309\u952E\u3002\u652F\u6301 Ctrl/Alt/Shift \u52A0\u5355\u4E2A\u6309\u952E\u3002",
      "previousPageHotkey",
      DEFAULT_SETTINGS.previousPageHotkey
    );
    this.addTextSetting(
      "\u4E0B\u4E00\u9875\u5FEB\u6377\u952E",
      "\u9ED8\u8BA4 l\u3002\u9664\u53F3\u65B9\u5411\u952E\u5916\uFF0C\u7528\u4E8E\u5411\u540E\u7FFB\u9875\u7684\u81EA\u5B9A\u4E49\u6309\u952E\u3002\u652F\u6301 Ctrl/Alt/Shift \u52A0\u5355\u4E2A\u6309\u952E\u3002",
      "nextPageHotkey",
      DEFAULT_SETTINGS.nextPageHotkey
    );
    containerEl.createEl("h3", { text: "\u6807\u6CE8\u4E0E\u6279\u6CE8" });
    this.addTextSetting(
      "\u6807\u6CE8\u9AD8\u4EAE\u989C\u8272",
      "RGB \u683C\u5F0F\uFF0C\u5982 255,200,50\u3002\u7559\u7A7A\u5219\u8DDF\u968F\u6D4F\u89C8\u5668\u9009\u533A\u8272\u3002",
      "annotationHighlightColor",
      "\u4F8B\u5982 255,200,50"
    );
    this.addTextSetting(
      "\u5BFC\u51FA\u76EE\u5F55",
      "vault \u5185\u76F8\u5BF9\u8DEF\u5F84\uFF1B\u7559\u7A7A\u5219\u5BFC\u51FA\u5230\u6839\u76EE\u5F55\u3002\u6587\u4EF6\u540D\u56FA\u5B9A\u4E3A\u300C\u4E66\u540D.md\u300D\u3002",
      "annotationExportDir",
      "\u4F8B\u5982 \u9605\u8BFB\u7B14\u8BB0"
    );
    new import_obsidian2.Setting(containerEl).setName("\u5BFC\u51FA\u540E\u5220\u9664\u5BF9\u5E94\u7B14\u8BB0").setDesc("\u5BFC\u51FA\u4E00\u672C\u4E66\u7684 Markdown \u7B14\u8BB0\u6210\u529F\u540E\uFF0C\u5220\u9664\u8BE5\u4E66\u5DF2\u5BFC\u51FA\u7684\u6807\u6CE8\u4E0E\u6279\u6CE8\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.deleteAnnotationsAfterExport).onChange(async (v) => {
        this.plugin.settings.deleteAnnotationsAfterExport = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    containerEl.createEl("h3", { text: "\u4E66\u5E93 Git \u540C\u6B65" });
    new import_obsidian2.Setting(containerEl).setName("\u4E66\u5E93\u76EE\u5F55").setDesc("\u5B58\u653E\u5C0F\u8BF4 TXT \u6587\u4EF6\u7684\u76EE\u5F55\u8DEF\u5F84\uFF08\u7EDD\u5BF9\u8DEF\u5F84\u6216\u76F8\u5BF9\u4E8E vault \u7684\u8DEF\u5F84\uFF09\u3002\u63D2\u4EF6\u542F\u52A8 10 \u79D2\u540E\u626B\u63CF\u6587\u4EF6\u53D8\u5316\uFF0C\u6709\u53D8\u52A8\u5219\u81EA\u52A8\u6267\u884C git add / commit / push\u3002\u7559\u7A7A\u7981\u7528\u3002").addText(
      (text) => text.setPlaceholder("\u4F8B\u5982 D:\\novels \u6216 novels").setValue(this.plugin.settings.bookLibraryPath).onChange(async (v) => {
        this.plugin.settings.bookLibraryPath = v.trim();
        await this.plugin.savePluginData();
        this.plugin.scheduleBookLibraryScan();
      })
    );
    containerEl.createEl("h3", { text: "\u6570\u636E\u5907\u4EFD" });
    this.addTextSetting(
      "\u5907\u4EFD\u8DEF\u5F84",
      "data.json \u7684\u5907\u4EFD\u76EE\u5F55\u6216\u6587\u4EF6\u8DEF\u5F84\uFF1B\u652F\u6301 vault \u5185\u76F8\u5BF9\u8DEF\u5F84\u6216\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\u3002\u7559\u7A7A\u5219\u5907\u4EFD\u5230\u63D2\u4EF6\u76EE\u5F55 data.backup.json\u3002",
      "dataBackupPath",
      ".obsidian/plugins/puffs-reader/data.backup.json"
    );
    this.addNumberSetting("\u5907\u4EFD\u9891\u7387", "\u6BCF\u9694\u591A\u5C11\u5C0F\u65F6\u81EA\u52A8\u8986\u76D6\u5907\u4EFD\u4E00\u6B21 data.json\u3002", "dataBackupFrequencyHours", 1, 720, 1, "\u5C0F\u65F6");
  }
  addNumberSetting(name, desc, key, min, max, step, unit) {
    let sliderControl = null;
    let textControl = null;
    let isSyncing = false;
    const clamp = (value) => Math.min(max, Math.max(min, value));
    const format = (value) => String(value);
    const save = async (value, syncText) => {
      const next = clamp(value);
      this.plugin.settings[key] = next;
      isSyncing = true;
      sliderControl == null ? void 0 : sliderControl.setValue(next);
      if (syncText) textControl == null ? void 0 : textControl.setValue(format(next));
      isSyncing = false;
      await this.plugin.savePluginData();
      this.refreshOpenReaders();
    };
    new import_obsidian2.Setting(this.containerEl).setName(name).setDesc(desc).addSlider(
      (slider) => (sliderControl = slider).setLimits(min, max, step).setValue(this.plugin.settings[key]).setDynamicTooltip().onChange((v) => {
        if (isSyncing) return;
        save(v, true);
      })
    ).addText((text) => {
      textControl = text;
      const unitEl = document.createElement("span");
      unitEl.className = "puffs-setting-unit";
      unitEl.textContent = unit;
      text.inputEl.insertAdjacentElement("afterend", unitEl);
      return text.setValue(String(this.plugin.settings[key])).setPlaceholder(unit).onChange((v) => {
        if (isSyncing) return;
        const n = Number(v);
        if (Number.isNaN(n)) return;
        save(n, false);
      });
    });
  }
  addNumberSettingInMinutes(name, desc, key, min, max, step, unit) {
    let sliderControl = null;
    let textControl = null;
    let isSyncing = false;
    const toMinutes = (valueMs) => Math.round(valueMs / 6e4);
    const clamp = (value) => Math.min(max, Math.max(min, value));
    const save = async (valueMinutes, syncText) => {
      const nextMinutes = clamp(valueMinutes);
      this.plugin.settings[key] = nextMinutes * 6e4;
      isSyncing = true;
      sliderControl == null ? void 0 : sliderControl.setValue(nextMinutes);
      if (syncText) textControl == null ? void 0 : textControl.setValue(String(nextMinutes));
      isSyncing = false;
      await this.plugin.savePluginData();
      this.refreshOpenReaders();
    };
    const currentMinutes = clamp(toMinutes(Number(this.plugin.settings[key])));
    new import_obsidian2.Setting(this.containerEl).setName(name).setDesc(desc).addSlider(
      (slider) => (sliderControl = slider).setLimits(min, max, step).setValue(currentMinutes).setDynamicTooltip().onChange((v) => {
        if (isSyncing) return;
        save(v, true);
      })
    ).addText((text) => {
      textControl = text;
      const unitEl = document.createElement("span");
      unitEl.className = "puffs-setting-unit";
      unitEl.textContent = unit;
      text.inputEl.insertAdjacentElement("afterend", unitEl);
      return text.setValue(String(currentMinutes)).setPlaceholder(unit).onChange((v) => {
        if (isSyncing) return;
        const n = Number(v);
        if (Number.isNaN(n)) return;
        save(n, false);
      });
    });
  }
  addTextSetting(name, desc, key, placeholder) {
    new import_obsidian2.Setting(this.containerEl).setName(name).setDesc(desc).addText(
      (text) => text.setPlaceholder(placeholder).setValue(this.plugin.settings[key]).onChange(async (v) => {
        const fallback = key === "searchHotkey" ? DEFAULT_SETTINGS.searchHotkey : key === "tocPanelHotkey" ? DEFAULT_SETTINGS.tocPanelHotkey : key === "copySourceHotkey" ? DEFAULT_SETTINGS.copySourceHotkey : key === "breakdownTextDir" ? DEFAULT_SETTINGS.breakdownTextDir : key === "previousPageHotkey" ? DEFAULT_SETTINGS.previousPageHotkey : key === "nextPageHotkey" ? DEFAULT_SETTINGS.nextPageHotkey : key === "chapterTitleRegex" ? DEFAULT_SETTINGS.chapterTitleRegex : key === "prologueTitleRegex" ? DEFAULT_SETTINGS.prologueTitleRegex : "";
        this.plugin.settings[key] = v.trim() || fallback;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
  }
  refreshOpenReaders() {
    var _a;
    for (const leaf of this.app.workspace.getLeavesOfType("puffs-reader-view")) {
      const view = leaf.view;
      (_a = view.refreshSettingsFromGlobal) == null ? void 0 : _a.call(view);
    }
  }
};

// src/main.ts
var execAsync = (0, import_util.promisify)(import_child_process.exec);
var READING_STATS_VIEW_TYPE = "puffs-reading-stats-view";
var LEGACY_DEFAULT_TOC_REGEX = "^\\s*\u7B2C[\u96F6\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\u4E24\\d]+[\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7].*$";
var LEGACY_DEFAULT_CHAPTER_TITLE_REGEX = "^\\s*\u7B2C([\u96F6\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\u4E24\\d]+)([\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7])\\s*(.*)$";
var LEGACY_PROLOGUE_TOC_REGEX = "^\\s*(?:\u7B2C[\u96F6\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\u4E24\\d]+[\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7].*|(?:\u5E8F\u7AE0|\u6954\u5B50|\u5F15\u5B50)(?:\\s+.*)?)$";
var LEGACY_PROLOGUE_CHAPTER_TITLE_REGEX = "^\\s*(?:\u7B2C([\u96F6\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\u4E24\\d]+)([\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7])\\s*(.*)|((?:\u5E8F\u7AE0|\u6954\u5B50|\u5F15\u5B50)(?:\\s+.*)?))$";
var SUMMARY_BOOK_SUFFIX = "-\u6982\u62EC\u7248";
var UNRECOGNIZED_CHAPTER_TITLE = "\u672A\u8BC6\u522B\u7AE0\u8282";
function createEmptyBookTags() {
  return { genre: [], feature: [], accumulation: [] };
}
function normalizeTagName(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normalizeAccumulationTagName(value) {
  return normalizeTagName(value).replace(/^已积累/, "").trim();
}
function uniqueNormalizedTags(values, normalize = normalizeTagName) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    const tag = normalize(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}
function normalizePositiveChapter(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return void 0;
  return n;
}
function normalizeBookTags(input) {
  const raw = input != null ? input : {};
  const status = normalizeTagName(raw.status);
  const accumulation = Array.isArray(raw.accumulation) ? raw.accumulation.map((item) => {
    const record = item;
    const name = normalizeAccumulationTagName(record == null ? void 0 : record.name);
    if (!name) return null;
    const startChapter = normalizePositiveChapter(record == null ? void 0 : record.startChapter);
    const normalizedEnd = normalizePositiveChapter(record == null ? void 0 : record.endChapter);
    const endChapter = startChapter !== void 0 && normalizedEnd !== void 0 && normalizedEnd < startChapter ? void 0 : normalizedEnd;
    return {
      name,
      ...startChapter !== void 0 ? { startChapter } : {},
      ...endChapter !== void 0 ? { endChapter } : {}
    };
  }).filter((item) => item !== null) : [];
  const byName = /* @__PURE__ */ new Map();
  for (const item of accumulation) {
    if (!byName.has(item.name)) byName.set(item.name, item);
  }
  return {
    genre: uniqueNormalizedTags(Array.isArray(raw.genre) ? raw.genre : []),
    ...status ? { status } : {},
    feature: uniqueNormalizedTags(Array.isArray(raw.feature) ? raw.feature : []),
    accumulation: Array.from(byName.values())
  };
}
function hasAnyBookTags(tags) {
  const normalized = normalizeBookTags(tags);
  return normalized.genre.length > 0 || !!normalized.status || normalized.feature.length > 0 || normalized.accumulation.length > 0;
}
function normalizeTagCatalog(input) {
  var _a, _b, _c, _d, _e, _f;
  return {
    genre: uniqueNormalizedTags([...(_a = DEFAULT_TAG_CATALOG.genre) != null ? _a : [], ...(_b = input == null ? void 0 : input.genre) != null ? _b : []]),
    status: uniqueNormalizedTags([...(_c = DEFAULT_TAG_CATALOG.status) != null ? _c : [], ...(_d = input == null ? void 0 : input.status) != null ? _d : []]),
    feature: uniqueNormalizedTags([...(_e = DEFAULT_TAG_CATALOG.feature) != null ? _e : [], ...(_f = input == null ? void 0 : input.feature) != null ? _f : []])
  };
}
function formatAccumulationTagLabel(tag) {
  if (tag.startChapter !== void 0 && tag.endChapter !== void 0) {
    return `${tag.name} ${tag.startChapter}-${tag.endChapter}\u7AE0`;
  }
  if (tag.startChapter !== void 0) return `${tag.name} \u7B2C${tag.startChapter}\u7AE0\u8D77`;
  if (tag.endChapter !== void 0) return `${tag.name} \u81F3\u7B2C${tag.endChapter}\u7AE0`;
  return tag.name;
}
function getReadingStatsDisplayTitle(filePath, title) {
  var _a;
  const trimmedTitle = (title != null ? title : "").trim();
  if (trimmedTitle) return trimmedTitle;
  const baseName = (_a = filePath.split(/[\\/]/).pop()) != null ? _a : filePath;
  return baseName.replace(/\.[^.]+$/, "") || filePath;
}
function stripSummaryBookSuffix(title) {
  return title.endsWith(SUMMARY_BOOK_SUFFIX) ? title.slice(0, -SUMMARY_BOOK_SUFFIX.length) : title;
}
function getReadingStatsGroupKey(filePath, title) {
  return stripSummaryBookSuffix(getReadingStatsDisplayTitle(filePath, title));
}
function isSummaryReadingStatsBook(filePath, title) {
  var _a;
  const displayTitle = (title != null ? title : "").trim();
  const baseName = ((_a = filePath.split(/[\\/]/).pop()) != null ? _a : filePath).replace(/\.[^.]+$/, "");
  return displayTitle.endsWith(SUMMARY_BOOK_SUFFIX) || baseName.endsWith(SUMMARY_BOOK_SUFFIX);
}
var TxtFileSuggestModal = class extends import_obsidian3.FuzzySuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder("\u9009\u62E9\u8981\u9605\u8BFB\u7684 TXT \u6587\u4EF6...");
  }
  /** 获取仓库中全部 .txt 文件 */
  getItems() {
    return this.plugin.getSelectableBookFiles();
  }
  /** 显示文件路径作为选项文本 */
  getItemText(item) {
    return item.path;
  }
  /** 用户选中后，在阅读器中打开该文件 */
  onChooseItem(item) {
    this.plugin.openInReader(item);
  }
};
var ReadingStatsView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.selectedBookPath = null;
    this.renderVersion = 0;
    this.globalMetric = null;
    this.bookMetric = null;
    this.speedUnit = "hour";
    this.tagFilters = {
      genre: /* @__PURE__ */ new Set(),
      status: /* @__PURE__ */ new Set(),
      feature: /* @__PURE__ */ new Set(),
      accumulation: /* @__PURE__ */ new Set()
    };
    this.plugin = plugin;
  }
  getViewType() {
    return READING_STATS_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u9605\u8BFB\u7EDF\u8BA1";
  }
  getIcon() {
    return "bar-chart-3";
  }
  async onOpen() {
    this.render();
  }
  showGlobalDefault() {
    this.selectedBookPath = null;
    this.globalMetric = null;
    this.bookMetric = null;
    this.render();
  }
  getState() {
    return { book: this.selectedBookPath };
  }
  async setState(state, result) {
    const viewState = state;
    this.selectedBookPath = typeof (viewState == null ? void 0 : viewState.book) === "string" ? viewState.book : null;
    this.render();
    await super.setState(state, result);
  }
  render() {
    this.renderVersion++;
    this.contentEl.empty();
    this.contentEl.addClass("puffs-reading-stats-view");
    const page = this.contentEl.createDiv({ cls: "puffs-reading-stats-page" });
    if (this.selectedBookPath) {
      this.renderBookDetail(page, this.selectedBookPath);
    } else {
      this.renderGlobal(page);
    }
  }
  renderGlobal(parent) {
    const allBooks = this.getAggregatedBooks().sort((a, b) => b.lastReadAt - a.lastReadAt);
    const books = allBooks.filter((book) => this.matchesTagFilters(book));
    const dailyEntries = this.getDailyEntriesForBooks(books).sort((a, b) => a[0].localeCompare(b[0]));
    const totalReadingMs = dailyEntries.reduce((sum, [, item]) => sum + item.readingMs, 0);
    const totalReadWords = dailyEntries.reduce((sum, [, item]) => sum + item.readWords, 0);
    const readingDays = dailyEntries.filter(([, item]) => item.readingMs > 0 || item.readWords > 0).length;
    this.renderHeader(parent, "\u9605\u8BFB\u7EDF\u8BA1");
    this.renderTagFilters(parent, allBooks);
    const summary = parent.createDiv({ cls: "puffs-reading-stats-summary" });
    summary.addClass("is-global");
    this.createSummaryItem(summary, "\u9605\u8BFB\u5929\u6570", `${readingDays} \u5929`);
    this.createSummaryItem(summary, "\u7D2F\u8BA1\u5B57\u6570", this.formatCompactNumber(totalReadWords), "words", this.globalMetric === "words", () => this.toggleGlobalMetric("words"));
    this.createSummaryItem(summary, "\u7D2F\u8BA1\u65F6\u957F", this.formatCompactDuration(totalReadingMs), "time", this.globalMetric === "time", () => this.toggleGlobalMetric("time"));
    this.createSummaryItem(summary, "\u5E73\u5747\u9605\u8BFB\u901F\u5EA6", this.formatSpeed(totalReadWords, totalReadingMs, "hour"), "speed", this.globalMetric === "speed", () => this.toggleGlobalMetric("speed"));
    this.createSummaryItem(summary, "\u7EDF\u8BA1\u4E66\u7C4D", `${books.length} \u672C`);
    if (this.globalMetric) {
      this.renderMetricChart(parent, this.globalMetric, dailyEntries.map(([date, item]) => ({
        date,
        readWords: item.readWords,
        readingMs: item.readingMs
      })));
    }
    this.createSectionTitle(parent, "\u6700\u8FD1\u9605\u8BFB");
    const list = parent.createDiv({ cls: "puffs-reading-stats-list" });
    if (books.length === 0) {
      list.createDiv({
        cls: "puffs-reading-stats-empty",
        text: allBooks.length > 0 && this.hasActiveTagFilters() ? "\u6CA1\u6709\u5339\u914D\u5F53\u524D\u6807\u7B7E\u7B5B\u9009\u7684\u9605\u8BFB\u7EDF\u8BA1\u3002" : "\u6682\u65E0\u9605\u8BFB\u7EDF\u8BA1\u3002\u6253\u5F00\u4E00\u672C\u4E66\u5E76\u505C\u7559\u9605\u8BFB\u540E\u5F00\u59CB\u8BB0\u5F55\u3002"
      });
      return;
    }
    for (const book of books) {
      const card = list.createDiv({ cls: "puffs-reading-stats-book" });
      const openBook = () => {
        this.selectedBookPath = book.groupKey;
        this.render();
      };
      card.setAttr("tabindex", "0");
      card.addEventListener("click", openBook);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openBook();
        }
      });
      this.registerBookStatsContextMenu(card, book.groupKey);
      const main = card.createDiv({ cls: "puffs-reading-stats-book-main" });
      main.createDiv({ cls: "puffs-reading-stats-book-title", text: book.title });
      this.renderBookTagBadges(main, book.tags);
      const meta = main.createDiv({ cls: "puffs-reading-stats-book-meta" });
      meta.createSpan({
        text: [
          `\u65F6\u957F ${this.formatCompactDuration(book.totalReadingMs)}`,
          `\u5B57\u6570 ${this.formatCompactNumber(book.totalReadWords)}`,
          `\u5E73\u5747\u9605\u8BFB\u901F\u5EA6 ${this.formatSpeed(book.totalReadWords, book.totalReadingMs, "hour")}`,
          `\u6700\u8FD1 ${this.formatDateTime(book.lastReadAt)}`
        ].join("\uFF1B")
      });
      const arrow = card.createSpan({ cls: "puffs-reading-stats-book-arrow" });
      (0, import_obsidian3.setIcon)(arrow, "chevron-right");
    }
  }
  renderBookDetail(parent, groupKey) {
    var _a, _b;
    const books = this.getAggregatedBooks();
    const book = (_a = books.find((item) => item.groupKey === groupKey)) != null ? _a : books.find((item) => item.filePaths.includes(groupKey));
    if (!book) {
      this.selectedBookPath = null;
      this.renderGlobal(parent);
      return;
    }
    this.selectedBookPath = book.groupKey;
    this.renderHeader(parent, book.title, true);
    this.renderBookTagBadges(parent, book.tags, "puffs-reading-stats-detail-tags");
    const dailyEntries = Object.entries((_b = book.daily) != null ? _b : {}).sort((a, b) => b[0].localeCompare(a[0]));
    const readingDays = dailyEntries.filter(([, item]) => item.readingMs > 0 || item.readWords > 0).length;
    const summary = parent.createDiv({ cls: "puffs-reading-stats-summary" });
    summary.addClass("is-detail");
    this.createSummaryItem(summary, "\u9605\u8BFB\u5929\u6570", `${readingDays} \u5929`);
    this.createSummaryItem(summary, "\u7D2F\u8BA1\u5B57\u6570", this.formatCompactNumber(book.totalReadWords), "words", this.bookMetric === "words", () => this.toggleBookMetric("words"));
    this.createSummaryItem(summary, "\u7D2F\u8BA1\u65F6\u957F", this.formatCompactDuration(book.totalReadingMs), "time", this.bookMetric === "time", () => this.toggleBookMetric("time"));
    this.createSummaryItem(summary, "\u5E73\u5747\u9605\u8BFB\u901F\u5EA6", this.formatSpeed(book.totalReadWords, book.totalReadingMs, "hour"), "speed", this.bookMetric === "speed", () => this.toggleBookMetric("speed"));
    if (this.bookMetric) {
      this.renderMetricChart(parent, this.bookMetric, [...dailyEntries].reverse().map(([date, item]) => ({
        date,
        readWords: item.readWords,
        readingMs: item.readingMs
      })));
    }
    this.createSectionTitle(parent, "\u6BCF\u65E5\u660E\u7EC6");
    const list = parent.createDiv({ cls: "puffs-reading-stats-list" });
    if (dailyEntries.length === 0) {
      list.createDiv({ cls: "puffs-reading-stats-empty", text: "\u8FD9\u672C\u4E66\u6682\u65E0\u6BCF\u65E5\u660E\u7EC6\u3002" });
      return;
    }
    for (const [date, item] of dailyEntries) {
      const card = list.createDiv({ cls: "puffs-reading-stats-day" });
      this.registerBookDailyStatsContextMenu(card, book.groupKey, date);
      card.createDiv({ cls: "puffs-reading-stats-day-title", text: date });
      const meta = card.createDiv({ cls: "puffs-reading-stats-book-meta" });
      meta.createSpan({
        text: [
          `\u65F6\u957F ${this.formatCompactDuration(item.readingMs)}`,
          `\u5B57\u6570 ${this.formatCompactNumber(item.readWords)}`,
          `\u5E73\u5747\u9605\u8BFB\u901F\u5EA6 ${this.formatSpeed(item.readWords, item.readingMs, "hour")}`
        ].join("\uFF1B")
      });
      const chapterText = this.formatChapterRanges(item.readChapterRanges, "\u9605\u8BFB\u7AE0\u8282");
      if (chapterText) {
        card.createDiv({ cls: "puffs-reading-stats-chapters puffs-reading-stats-day-chapters", text: chapterText });
      }
    }
  }
  renderHeader(parent, title, withBack = false) {
    const header = parent.createDiv({ cls: "puffs-reading-stats-header" });
    if (withBack) {
      const back = header.createEl("button", { cls: "puffs-icon-btn puffs-reading-stats-back", attr: { "aria-label": "\u8FD4\u56DE\u9605\u8BFB\u7EDF\u8BA1" } });
      (0, import_obsidian3.setIcon)(back, "arrow-left");
      back.addEventListener("click", () => {
        this.selectedBookPath = null;
        this.globalMetric = null;
        this.render();
      });
    }
    header.createEl("h3", { cls: "puffs-reading-stats-title", text: title });
  }
  createSummaryItem(parent, label, value, metric, active = false, onClick) {
    const item = parent.createDiv({ cls: "puffs-reading-stats-summary-item" });
    if (metric) {
      item.addClass("is-clickable");
      item.setAttr("tabindex", "0");
      item.setAttr("role", "button");
      item.setAttr("aria-pressed", active ? "true" : "false");
    }
    if (active) item.addClass("is-active");
    item.createDiv({ cls: "puffs-reading-stats-summary-label", text: label });
    item.createDiv({ cls: "puffs-reading-stats-summary-value", text: value });
    if (onClick) {
      item.addEventListener("click", onClick);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      });
    }
  }
  createSectionTitle(parent, title) {
    parent.createDiv({ cls: "puffs-reading-stats-section-title", text: title });
  }
  renderTagFilters(parent, books) {
    const options = this.getTagFilterOptions(books);
    const hasOptions = options.genre.length > 0 || options.status.length > 0 || options.feature.length > 0 || options.accumulation.length > 0;
    if (!hasOptions && !this.hasActiveTagFilters()) return;
    const panel = parent.createDiv({ cls: "puffs-reading-stats-tag-filter" });
    const header = panel.createDiv({ cls: "puffs-reading-stats-tag-filter-head" });
    header.createDiv({ cls: "puffs-reading-stats-tag-filter-title", text: "\u6807\u7B7E\u7B5B\u9009" });
    if (this.hasActiveTagFilters()) {
      const clearBtn = header.createEl("button", { cls: "puffs-reading-stats-tag-clear", text: "\u6E05\u9664" });
      clearBtn.addEventListener("click", () => {
        this.clearTagFilters();
        this.render();
      });
    }
    this.renderTagFilterGroup(panel, "\u9898\u6750", "genre", options.genre);
    this.renderTagFilterGroup(panel, "\u72B6\u6001", "status", options.status);
    this.renderTagFilterGroup(panel, "\u7279\u8272", "feature", options.feature);
    this.renderTagFilterGroup(panel, "\u79EF\u7D2F", "accumulation", options.accumulation);
  }
  renderTagFilterGroup(parent, label, group, options) {
    if (options.length === 0) return;
    const row = parent.createDiv({ cls: "puffs-reading-stats-tag-filter-row" });
    row.createSpan({ cls: "puffs-reading-stats-tag-filter-label", text: label });
    const chips = row.createDiv({ cls: "puffs-reading-stats-tag-filter-chips" });
    for (const option of options) {
      const active = this.tagFilters[group].has(option);
      const chip = chips.createEl("button", {
        cls: active ? "puffs-tag-chip is-active" : "puffs-tag-chip",
        text: option
      });
      chip.addEventListener("click", () => {
        this.toggleTagFilter(group, option);
        this.render();
      });
    }
  }
  getTagFilterOptions(books) {
    const catalog = this.plugin.getTagCatalog();
    return {
      genre: uniqueNormalizedTags([...catalog.genre, ...books.flatMap((book) => book.tags.genre)]),
      status: uniqueNormalizedTags([...catalog.status, ...books.map((book) => {
        var _a;
        return (_a = book.tags.status) != null ? _a : "";
      })]),
      feature: uniqueNormalizedTags([...catalog.feature, ...books.flatMap((book) => book.tags.feature)]),
      accumulation: uniqueNormalizedTags([
        ...catalog.feature,
        ...books.flatMap((book) => book.tags.accumulation.map((tag) => tag.name))
      ])
    };
  }
  toggleTagFilter(group, value) {
    const filters = this.tagFilters[group];
    if (filters.has(value)) filters.delete(value);
    else filters.add(value);
    this.globalMetric = null;
  }
  clearTagFilters() {
    for (const filters of Object.values(this.tagFilters)) filters.clear();
    this.globalMetric = null;
  }
  hasActiveTagFilters() {
    return Object.values(this.tagFilters).some((filters) => filters.size > 0);
  }
  matchesTagFilters(book) {
    const tags = normalizeBookTags(book.tags);
    return this.matchesTagFilterGroup(this.tagFilters.genre, tags.genre) && this.matchesTagFilterGroup(this.tagFilters.status, tags.status ? [tags.status] : []) && this.matchesTagFilterGroup(this.tagFilters.feature, tags.feature) && this.matchesTagFilterGroup(this.tagFilters.accumulation, tags.accumulation.map((tag) => tag.name));
  }
  matchesTagFilterGroup(filters, values) {
    return filters.size === 0 || values.some((value) => filters.has(value));
  }
  getDailyEntriesForBooks(books) {
    var _a, _b, _c;
    const dailyByDate = {};
    for (const book of books) {
      for (const [date, daily] of Object.entries((_a = book.daily) != null ? _a : {})) {
        const aggregate = (_b = dailyByDate[date]) != null ? _b : { readingMs: 0, readWords: 0, readChapterRanges: [] };
        aggregate.readingMs += daily.readingMs;
        aggregate.readWords += daily.readWords;
        aggregate.readChapterRanges = this.mergeDisplayableChapterRanges([
          ...aggregate.readChapterRanges,
          ...(_c = daily.readChapterRanges) != null ? _c : []
        ]);
        dailyByDate[date] = aggregate;
      }
    }
    return Object.entries(dailyByDate);
  }
  renderBookTagBadges(parent, tags, extraClass = "") {
    const items = this.getBookTagBadgeLabels(tags);
    if (items.length === 0) return;
    const row = parent.createDiv({
      cls: ["puffs-reading-stats-tags", extraClass].filter(Boolean).join(" ")
    });
    for (const item of items) {
      row.createSpan({ cls: `puffs-reading-stats-tag is-${item.group}`, text: item.label });
    }
  }
  getBookTagBadgeLabels(tags) {
    const normalized = normalizeBookTags(tags);
    return [
      ...normalized.genre.map((label) => ({ group: "genre", label })),
      ...normalized.status ? [{ group: "status", label: normalized.status }] : [],
      ...normalized.feature.map((label) => ({ group: "feature", label })),
      ...normalized.accumulation.map((tag) => ({
        group: "accumulation",
        label: formatAccumulationTagLabel(tag)
      }))
    ];
  }
  getAggregatedBooks() {
    var _a, _b, _c, _d;
    const stats = this.plugin.getReadingStats();
    const groups = /* @__PURE__ */ new Map();
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
          hasOriginalSource: false,
          hasOriginalTags: false,
          tags: createEmptyBookTags(),
          totalReadingMs: 0,
          totalReadWords: 0,
          readChapterRanges: [],
          daily: {},
          lastReadAt: 0
        };
        groups.set(groupKey, group);
      }
      if (!isSummary && !group.hasOriginalSource) {
        group.title = sourceTitle;
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
          ...(_a = book.readChapterRanges) != null ? _a : []
        ]);
      }
      for (const [date, daily] of Object.entries((_b = book.daily) != null ? _b : {})) {
        const groupDaily = (_c = group.daily[date]) != null ? _c : { readingMs: 0, readWords: 0, readChapterRanges: [] };
        groupDaily.readingMs += daily.readingMs;
        groupDaily.readWords += daily.readWords;
        if (!isSummary) {
          groupDaily.readChapterRanges = this.mergeDisplayableChapterRanges([
            ...groupDaily.readChapterRanges,
            ...(_d = daily.readChapterRanges) != null ? _d : []
          ]);
        }
        group.daily[date] = groupDaily;
      }
    }
    return Array.from(groups.values());
  }
  registerBookStatsContextMenu(card, groupKey) {
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = new import_obsidian3.Menu();
      menu.addItem((item) => {
        item.setTitle("\u5220\u9664\u6570\u636E").setIcon("trash").onClick(() => {
          this.plugin.deleteReadingStatsGroup(groupKey).then(() => {
            new import_obsidian3.Notice("\u5DF2\u5220\u9664\u8FD9\u7EC4\u4E66\u7684\u9605\u8BFB\u7EDF\u8BA1");
            if (this.selectedBookPath === groupKey) this.selectedBookPath = null;
            this.globalMetric = null;
            this.bookMetric = null;
            this.render();
          }).catch((error) => console.error("[Puffs Reader] Failed to delete book reading stats:", error));
        });
      });
      menu.showAtMouseEvent(event);
    });
  }
  registerBookDailyStatsContextMenu(card, groupKey, date) {
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = new import_obsidian3.Menu();
      menu.addItem((item) => {
        item.setTitle("\u5220\u9664\u6570\u636E").setIcon("trash").onClick(() => {
          this.plugin.deleteReadingStatsGroupDaily(groupKey, date).then(() => {
            new import_obsidian3.Notice("\u5DF2\u5220\u9664\u5F53\u5929\u9605\u8BFB\u7EDF\u8BA1");
            this.bookMetric = null;
            this.render();
          }).catch((error) => console.error("[Puffs Reader] Failed to delete book daily reading stats:", error));
        });
      });
      menu.showAtMouseEvent(event);
    });
  }
  toggleGlobalMetric(metric) {
    this.globalMetric = this.globalMetric === metric ? null : metric;
    if (this.globalMetric === "speed") this.speedUnit = "hour";
    this.render();
  }
  toggleBookMetric(metric) {
    this.bookMetric = this.bookMetric === metric ? null : metric;
    if (this.bookMetric === "speed") this.speedUnit = "hour";
    this.render();
  }
  renderMetricChart(parent, metric, entries) {
    const totalWords = entries.reduce((sum, item) => sum + item.readWords, 0);
    const totalMs = entries.reduce((sum, item) => sum + item.readingMs, 0);
    if (metric === "words") {
      this.renderLineChart(
        parent,
        "\u7D2F\u8BA1\u5B57\u6570",
        entries.map((item) => ({
          label: this.formatShortDate(item.date),
          value: item.readWords,
          title: `${item.date}\uFF1A${this.formatCompactNumber(item.readWords)} \u5B57`
        })),
        (value) => `${this.formatCompactNumber(value)}\u5B57`,
        `${this.formatCompactNumber(totalWords)}\u5B57`
      );
      return;
    }
    if (metric === "time") {
      this.renderLineChart(
        parent,
        "\u7D2F\u8BA1\u65F6\u957F",
        entries.map((item) => ({
          label: this.formatShortDate(item.date),
          value: item.readingMs / 6e4,
          title: `${item.date}\uFF1A${this.formatCompactDuration(item.readingMs)}`
        })),
        (value) => this.formatChartMinutes(value),
        this.formatCompactDuration(totalMs)
      );
      return;
    }
    this.renderLineChart(
      parent,
      "\u5E73\u5747\u9605\u8BFB\u901F\u5EA6",
      entries.map((item) => ({
        label: this.formatShortDate(item.date),
        value: this.getSpeedValue(item.readWords, item.readingMs, this.speedUnit),
        title: `${item.date}\uFF1A${this.formatSpeed(item.readWords, item.readingMs, this.speedUnit)}`
      })),
      (value) => `${this.formatCompactNumber(value)}${this.speedUnit === "hour" ? "\u5B57/h" : "\u5B57/min"}`,
      this.formatSpeed(totalWords, totalMs, this.speedUnit),
      (header) => this.renderSpeedUnitToggle(header)
    );
  }
  renderSpeedUnitToggle(parent) {
    const toggle = parent.createDiv({ cls: "puffs-reading-stats-chart-toggle" });
    for (const unit of ["hour", "minute"]) {
      const button = toggle.createEl("button", {
        text: unit === "hour" ? "\u5C0F\u65F6" : "\u5206\u949F",
        cls: unit === this.speedUnit ? "is-active" : ""
      });
      button.addEventListener("click", () => {
        this.speedUnit = unit;
        this.render();
      });
    }
  }
  renderLineChart(parent, title, points, formatValue, summaryText, renderHeaderControl) {
    const card = parent.createDiv({ cls: "puffs-reading-stats-chart-card" });
    const header = card.createDiv({ cls: "puffs-reading-stats-chart-header" });
    const titleWrap = header.createDiv({ cls: "puffs-reading-stats-chart-title-wrap" });
    titleWrap.createDiv({ cls: "puffs-reading-stats-chart-title", text: title });
    if (renderHeaderControl) renderHeaderControl(titleWrap);
    const valid = points.filter((point) => Number.isFinite(point.value));
    if (valid.length === 0 || valid.every((point) => point.value <= 0)) {
      card.createDiv({ cls: "puffs-reading-stats-empty", text: "\u6682\u65E0\u56FE\u8868\u6570\u636E" });
      return;
    }
    header.createDiv({ cls: "puffs-reading-stats-chart-total", text: summaryText });
    const width = 720;
    const height = 220;
    const padLeft = 48;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 34;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;
    const maxValue = Math.max(...valid.map((point) => point.value), 1);
    const x = (idx) => valid.length === 1 ? padLeft + plotWidth / 2 : padLeft + idx / (valid.length - 1) * plotWidth;
    const y = (value) => padTop + plotHeight - value / maxValue * plotHeight;
    const path = valid.map((point, idx) => `${idx === 0 ? "M" : "L"} ${x(idx).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "puffs-reading-stats-chart");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", title);
    svg.innerHTML = `
      <line class="puffs-chart-axis" x1="${padLeft}" y1="${padTop + plotHeight}" x2="${width - padRight}" y2="${padTop + plotHeight}" />
      <line class="puffs-chart-axis" x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotHeight}" />
      <text class="puffs-chart-label" x="${padLeft}" y="${padTop + 10}">${this.escapeSvg(formatValue(maxValue))}</text>
      <text class="puffs-chart-label" x="${padLeft}" y="${height - 8}">${this.escapeSvg(valid[0].label)}</text>
      <text class="puffs-chart-label puffs-chart-label-end" x="${width - padRight}" y="${height - 8}">${this.escapeSvg(valid[valid.length - 1].label)}</text>
      <path class="puffs-chart-line" d="${path}" />
    `;
    valid.forEach((point, idx) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("class", "puffs-chart-point");
      circle.setAttribute("cx", x(idx).toFixed(1));
      circle.setAttribute("cy", y(point.value).toFixed(1));
      circle.setAttribute("r", "3.5");
      const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
      titleEl.textContent = point.title;
      circle.appendChild(titleEl);
      svg.appendChild(circle);
    });
    card.appendChild(svg);
  }
  formatChapterRanges(ranges, label = "\u5DF2\u8BFB\u7AE0\u8282") {
    const displayRanges = this.mergeDisplayableChapterRanges(ranges);
    if (displayRanges.length === 0) return "";
    const labels = displayRanges.map((range) => {
      if (range.start === range.end || range.startTitle === range.endTitle) return range.startTitle;
      return `${range.startTitle} - ${range.endTitle}`;
    });
    return `${label}\uFF1A${[...new Set(labels)].join("\u3001")}`;
  }
  mergeDisplayableChapterRanges(ranges) {
    const sorted = ranges.filter(
      (range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end >= range.start && range.startTitle && range.endTitle && range.startTitle !== UNRECOGNIZED_CHAPTER_TITLE && range.endTitle !== UNRECOGNIZED_CHAPTER_TITLE
    ).map((range) => ({
      start: Math.floor(range.start),
      end: Math.floor(range.end),
      startTitle: range.startTitle,
      endTitle: range.endTitle
    })).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
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
  formatCompactDuration(ms) {
    const totalMinutes = Math.max(0, Math.round(ms / 6e4));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 10) return `${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${totalMinutes}min`;
  }
  formatChartMinutes(minutes) {
    const totalMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(totalMinutes / 60);
    const rest = totalMinutes % 60;
    if (hours >= 10) return `${hours}h`;
    if (hours > 0) return `${hours}h ${rest}min`;
    return `${totalMinutes}min`;
  }
  formatSpeed(words, ms, unit) {
    if (!Number.isFinite(words) || !Number.isFinite(ms) || words <= 0 || ms <= 0) return "--";
    const value = this.getSpeedValue(words, ms, unit);
    return `${this.formatCompactNumber(value)} \u5B57/${unit === "hour" ? "\u5C0F\u65F6" : "\u5206\u949F"}`;
  }
  getSpeedValue(words, ms, unit) {
    if (!Number.isFinite(words) || !Number.isFinite(ms) || words <= 0 || ms <= 0) return 0;
    return unit === "hour" ? words / (ms / 36e5) : words / (ms / 6e4);
  }
  formatCompactNumber(value) {
    const n = Math.max(0, Math.round(value));
    if (n < 1e4) return String(n);
    const compact = Math.round(n / 1e4 * 10) / 10;
    return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}W`;
  }
  formatNumber(value) {
    return Math.max(0, Math.floor(value)).toLocaleString("zh-CN");
  }
  formatDateTime(timestamp) {
    if (!timestamp) return "\u65E0";
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  formatShortDate(date) {
    return date.slice(5) || date;
  }
  escapeSvg(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
};
var PuffsReaderPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.progress = {};
    this.bookSettings = {};
    this.tagCatalog = normalizeTagCatalog(void 0);
    this.readingStats = { schemaVersion: 2, books: {}, daily: {} };
    this.lastDataBackupAt = 0;
    this.knownBooks = [];
    this.dataBackupTimer = null;
    this.bookScanTimer = null;
  }
  async onload() {
    await this.loadPluginData();
    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));
    this.registerView(READING_STATS_VIEW_TYPE, (leaf) => new ReadingStatsView(leaf, this));
    this.addCommand({
      id: "open-txt-in-reader",
      name: "\u5728\u9605\u8BFB\u5668\u4E2D\u6253\u5F00 TXT \u6587\u4EF6",
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "txt") {
          this.openInReader(activeFile);
        } else {
          new TxtFileSuggestModal(this).open();
        }
      }
    });
    this.addCommand({
      id: "search-current-reader-book",
      name: "Puffs Reader\uFF1A\u5168\u6587\u641C\u7D22",
      hotkeys: [{ modifiers: ["Ctrl"], key: "f" }],
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(ReaderView);
        if (view) view.toggleSearchFromHotkey();
      }
    });
    this.addCommand({
      id: "show-reading-stats",
      name: "Puffs Reader\uFF1A\u9605\u8BFB\u7EDF\u8BA1",
      callback: () => {
        this.openReadingStats();
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian3.TFile && file.extension === "txt") {
          menu.addItem((item) => {
            item.setTitle("\u5728 Puffs Reader \u4E2D\u6253\u5F00").setIcon("book-open").onClick(() => this.openInReader(file));
          });
        }
      })
    );
    this.addSettingTab(new SettingsTab(this.app, this));
    this.scheduleNextDataBackup();
    this.scheduleBookLibraryScan();
  }
  onunload() {
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
  async openInReader(file) {
    await this.markBookAsRecentlyRead(file.path);
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: READER_VIEW_TYPE,
      state: { file: file.path }
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (view instanceof ReaderView) {
      view.focusReader();
    }
  }
  async openReadingStats() {
    const existing = this.app.workspace.getLeavesOfType(READING_STATS_VIEW_TYPE)[0];
    const leaf = existing != null ? existing : this.app.workspace.getLeaf("tab");
    if (!existing) {
      await leaf.setViewState({ type: READING_STATS_VIEW_TYPE, state: {} });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof ReadingStatsView) {
      leaf.view.showGlobalDefault();
    }
  }
  // ═══════════════════════════ 数据持久化 ═══════════════════════════
  async loadPluginData() {
    var _a, _b, _c, _d, _e;
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data == null ? void 0 : data.settings);
    if (this.settings.tocRegex === LEGACY_DEFAULT_TOC_REGEX || this.settings.tocRegex === LEGACY_PROLOGUE_TOC_REGEX) {
      this.settings.tocRegex = DEFAULT_SETTINGS.tocRegex;
    }
    if (this.settings.chapterTitleRegex === LEGACY_DEFAULT_CHAPTER_TITLE_REGEX || this.settings.chapterTitleRegex === LEGACY_PROLOGUE_CHAPTER_TITLE_REGEX) {
      this.settings.chapterTitleRegex = DEFAULT_SETTINGS.chapterTitleRegex;
    }
    if (this.settings.readingStatsMinPageMs === 3e3 || this.settings.readingStatsMinPageMs === 500) {
      this.settings.readingStatsMinPageMs = DEFAULT_SETTINGS.readingStatsMinPageMs;
    }
    this.progress = (_a = data == null ? void 0 : data.progress) != null ? _a : {};
    this.bookSettings = (_b = data == null ? void 0 : data.bookSettings) != null ? _b : {};
    this.tagCatalog = normalizeTagCatalog(data == null ? void 0 : data.tagCatalog);
    this.readingStats = this.normalizeReadingStats(data == null ? void 0 : data.readingStats);
    this.lastDataBackupAt = (_c = data == null ? void 0 : data.lastDataBackupAt) != null ? _c : 0;
    this.knownBooks = (_d = data == null ? void 0 : data.knownBooks) != null ? _d : [];
    for (const [filePath, progress] of Object.entries(this.progress)) {
      if (progress.encoding && !((_e = this.bookSettings[filePath]) == null ? void 0 : _e.encoding)) {
        this.bookSettings[filePath] = {
          ...this.bookSettings[filePath],
          encoding: progress.encoding
        };
      }
    }
  }
  async savePluginData() {
    await this.writePluginData();
    await this.backupDataJsonIfDue();
  }
  async rescheduleDataBackup() {
    this.scheduleNextDataBackup();
    await this.backupDataJsonIfDue();
  }
  async writePluginData() {
    await this.saveData({
      settings: this.settings,
      progress: this.progress,
      bookSettings: this.bookSettings,
      tagCatalog: this.tagCatalog,
      readingStats: this.readingStats,
      lastDataBackupAt: this.lastDataBackupAt,
      knownBooks: this.knownBooks
    });
  }
  normalizeReadingStats(input) {
    var _a, _b, _c, _d, _e, _f;
    if (!input || input.schemaVersion !== 2) {
      return { schemaVersion: 2, books: {}, daily: {} };
    }
    const books = {};
    for (const [filePath, book] of Object.entries((_a = input == null ? void 0 : input.books) != null ? _a : {})) {
      books[filePath] = {
        title: book.title || ((_b = filePath.split("/").pop()) == null ? void 0 : _b.replace(/\.txt$/i, "")) || filePath,
        totalReadingMs: this.safeNonNegativeNumber(book.totalReadingMs),
        totalReadWords: this.safeNonNegativeNumber(book.totalReadWords),
        countedRanges: this.mergeCountedRanges((_c = book.countedRanges) != null ? _c : []),
        readChapterRanges: this.mergeChapterRanges((_d = book.readChapterRanges) != null ? _d : []),
        daily: this.normalizeBookDailyStats(book.daily),
        lastReadAt: this.safeNonNegativeNumber(book.lastReadAt)
      };
    }
    const daily = {};
    for (const [date, item] of Object.entries((_e = input == null ? void 0 : input.daily) != null ? _e : {})) {
      daily[date] = {
        readingMs: this.safeNonNegativeNumber(item.readingMs),
        readWords: this.safeNonNegativeNumber(item.readWords),
        bookPaths: [...new Set(((_f = item.bookPaths) != null ? _f : []).filter(Boolean))]
      };
    }
    return { schemaVersion: 2, books, daily };
  }
  safeNonNegativeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  normalizeBookDailyStats(input) {
    var _a;
    const result = {};
    for (const [date, item] of Object.entries(input != null ? input : {})) {
      result[date] = {
        readingMs: this.safeNonNegativeNumber(item.readingMs),
        readWords: this.safeNonNegativeNumber(item.readWords),
        readChapterRanges: this.mergeChapterRanges((_a = item.readChapterRanges) != null ? _a : [])
      };
    }
    return result;
  }
  scheduleNextDataBackup() {
    this.clearDataBackupTimer();
    const frequencyMs = this.getDataBackupFrequencyMs();
    if (frequencyMs <= 0) return;
    const now = Date.now();
    const elapsed = this.lastDataBackupAt > 0 ? now - this.lastDataBackupAt : frequencyMs;
    const delay = Math.max(0, frequencyMs - elapsed);
    this.dataBackupTimer = window.setTimeout(() => {
      this.dataBackupTimer = null;
      this.backupDataJsonIfDue().catch((error) => console.error("Puffs Reader data backup failed", error));
    }, delay);
  }
  clearDataBackupTimer() {
    if (this.dataBackupTimer === null) return;
    window.clearTimeout(this.dataBackupTimer);
    this.dataBackupTimer = null;
  }
  async backupDataJsonIfDue() {
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
  getDataBackupFrequencyMs() {
    const hours = Number(this.settings.dataBackupFrequencyHours);
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    return hours * 60 * 60 * 1e3;
  }
  async backupDataJson() {
    const sourcePath = (0, import_obsidian3.normalizePath)(`${this.getPluginDir()}/data.json`);
    if (!await this.app.vault.adapter.exists(sourcePath)) {
      await this.writePluginData();
    }
    const content = await this.app.vault.adapter.read(sourcePath);
    const targetPath = this.getDataBackupPath();
    if ((0, import_path.isAbsolute)(targetPath)) {
      await import_fs.promises.mkdir((0, import_path.dirname)(targetPath), { recursive: true });
      await import_fs.promises.writeFile(targetPath, content, "utf8");
      return;
    }
    const normalizedTarget = (0, import_obsidian3.normalizePath)(targetPath);
    const targetDir = normalizedTarget.split("/").slice(0, -1).join("/");
    if (targetDir) await this.ensureVaultFolder(targetDir);
    await this.app.vault.adapter.write(normalizedTarget, content);
  }
  async ensureVaultFolder(folderPath) {
    const parts = (0, import_obsidian3.normalizePath)(folderPath).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }
  getDataBackupPath() {
    const customPath = this.settings.dataBackupPath.trim();
    if (customPath) {
      if (this.isDataBackupDirectoryPath(customPath)) {
        return (0, import_path.isAbsolute)(customPath) ? (0, import_path.join)(customPath, "data.json") : (0, import_obsidian3.normalizePath)(`${customPath}/data.json`);
      }
      return customPath;
    }
    return (0, import_obsidian3.normalizePath)(`${this.getPluginDir()}/data.backup.json`);
  }
  isDataBackupDirectoryPath(path) {
    var _a;
    if (/[\\/]$/.test(path)) return true;
    const leaf = (_a = path.split(/[\\/]/).pop()) != null ? _a : "";
    return !leaf.toLowerCase().endsWith(".json");
  }
  // ═══════════════════════════ 书库 Git 同步 ═══════════════════════════
  scheduleBookLibraryScan() {
    if (this.bookScanTimer !== null) {
      window.clearTimeout(this.bookScanTimer);
      this.bookScanTimer = null;
    }
    if (!this.settings.bookLibraryPath.trim()) return;
    this.bookScanTimer = window.setTimeout(() => {
      this.bookScanTimer = null;
      this.scanBookLibrary().catch(
        (e) => console.error("[Puffs Reader] Book library scan failed:", e)
      );
    }, 1e4);
  }
  async scanBookLibrary() {
    const libPath = this.resolveBookLibraryPath();
    if (!libPath) return;
    const entries = await import_fs.promises.readdir(libPath);
    const currentBooks = entries.filter((f) => f.toLowerCase().endsWith(".txt")).sort();
    const knownSorted = [...this.knownBooks].sort();
    const changed = currentBooks.length !== knownSorted.length || currentBooks.some((b, i) => b !== knownSorted[i]);
    if (!changed) return;
    this.knownBooks = currentBooks;
    await this.savePluginData();
    await this.gitSyncBookLibrary(libPath);
  }
  async gitSyncBookLibrary(libPath) {
    var _a, _b, _c;
    try {
      await execAsync("git add .", { cwd: libPath });
    } catch (e) {
      console.error("[Puffs Reader] Book library git add error:", this.gitErrMsg(e));
      return;
    }
    try {
      await execAsync('git commit -m "update book library"', { cwd: libPath });
    } catch (e) {
      const err = e;
      const combined = `${(_a = err.stdout) != null ? _a : ""} ${(_b = err.stderr) != null ? _b : ""} ${(_c = err.message) != null ? _c : ""}`;
      if (combined.includes("nothing to commit") || combined.includes("nothing added to commit")) {
        console.log("[Puffs Reader] Book library: nothing to commit.");
        return;
      }
      console.error("[Puffs Reader] Book library git commit error:", this.gitErrMsg(e));
      return;
    }
    try {
      await execAsync("git push", { cwd: libPath });
      console.log("[Puffs Reader] Book library git sync completed successfully.");
    } catch (e) {
      console.error("[Puffs Reader] Book library git push error:", this.gitErrMsg(e));
    }
  }
  gitErrMsg(e) {
    const err = e;
    return [err.stderr, err.stdout, err.message].filter(Boolean).join(" | ");
  }
  resolveBookLibraryPath() {
    var _a;
    const raw = this.settings.bookLibraryPath.trim();
    if (!raw) return null;
    if ((0, import_path.isAbsolute)(raw)) return raw;
    const vaultBasePath = (_a = this.app.vault.adapter.basePath) != null ? _a : "";
    return (0, import_path.join)(vaultBasePath, raw);
  }
  getSelectableBookFiles() {
    const txtFiles = this.app.vault.getFiles().filter((file) => file.extension.toLowerCase() === "txt");
    const libraryPath = this.resolveBookLibraryPath();
    const selectableFiles = libraryPath ? txtFiles.filter((file) => {
      var _a;
      const vaultBasePath = (_a = this.app.vault.adapter.basePath) != null ? _a : "";
      const normalizedLibraryPath = (0, import_path.resolve)(libraryPath).toLowerCase();
      const parentPath = (0, import_path.dirname)((0, import_path.resolve)(vaultBasePath, file.path)).toLowerCase();
      return parentPath === normalizedLibraryPath;
    }) : txtFiles;
    return selectableFiles.sort((a, b) => {
      var _a, _b, _c, _d;
      const lastReadDiff = ((_b = (_a = this.progress[b.path]) == null ? void 0 : _a.lastRead) != null ? _b : 0) - ((_d = (_c = this.progress[a.path]) == null ? void 0 : _c.lastRead) != null ? _d : 0);
      return lastReadDiff || a.path.localeCompare(b.path, "zh-CN", { numeric: true });
    });
  }
  getPluginDir() {
    var _a;
    return (_a = this.manifest.dir) != null ? _a : `.obsidian/plugins/${this.manifest.id}`;
  }
  // ═══════════════════════════ 阅读进度 ═══════════════════════════
  getProgress(filePath) {
    return this.progress[filePath];
  }
  getReadingStats() {
    return this.readingStats;
  }
  async saveReadingStats(stats) {
    this.readingStats = this.normalizeReadingStats(stats);
    await this.savePluginData();
  }
  async deleteReadingStatsGroup(groupKey) {
    const filePaths = this.getReadingStatsGroupFilePaths(groupKey);
    if (filePaths.length === 0) return;
    let changed = false;
    for (const filePath of filePaths) {
      changed = this.deleteBookReadingStatsInMemory(filePath) || changed;
    }
    if (changed) await this.savePluginData();
  }
  async deleteReadingStatsGroupDaily(groupKey, date) {
    const filePaths = this.getReadingStatsGroupFilePaths(groupKey);
    if (filePaths.length === 0) return;
    let changed = false;
    for (const filePath of filePaths) {
      changed = this.deleteBookDailyReadingStatsInMemory(filePath, date) || changed;
    }
    if (changed) await this.savePluginData();
  }
  async deleteBookReadingStats(filePath) {
    if (!this.deleteBookReadingStatsInMemory(filePath)) return;
    await this.savePluginData();
  }
  deleteBookReadingStatsInMemory(filePath) {
    var _a;
    const book = this.readingStats.books[filePath];
    if (!book) return false;
    for (const [date, item] of Object.entries((_a = book.daily) != null ? _a : {})) {
      this.removeBookContributionFromDaily(date, filePath, item.readingMs, item.readWords);
    }
    delete this.readingStats.books[filePath];
    return true;
  }
  async deleteBookDailyReadingStats(filePath, date) {
    if (!this.deleteBookDailyReadingStatsInMemory(filePath, date)) return;
    await this.savePluginData();
  }
  deleteBookDailyReadingStatsInMemory(filePath, date) {
    var _a, _b;
    const book = this.readingStats.books[filePath];
    const daily = (_a = book == null ? void 0 : book.daily) == null ? void 0 : _a[date];
    if (!book || !daily) return false;
    this.removeBookContributionFromDaily(date, filePath, daily.readingMs, daily.readWords);
    delete book.daily[date];
    const remainingDaily = Object.entries((_b = book.daily) != null ? _b : {});
    if (remainingDaily.length === 0) {
      delete this.readingStats.books[filePath];
      return true;
    }
    book.totalReadingMs = remainingDaily.reduce((sum, [, item]) => sum + this.safeNonNegativeNumber(item.readingMs), 0);
    book.totalReadWords = remainingDaily.reduce((sum, [, item]) => sum + this.safeNonNegativeNumber(item.readWords), 0);
    book.readChapterRanges = this.mergeChapterRanges(remainingDaily.flatMap(([, item]) => {
      var _a2;
      return (_a2 = item.readChapterRanges) != null ? _a2 : [];
    }));
    book.lastReadAt = Math.max(...remainingDaily.map(([day]) => this.getEndOfLocalDayTimestamp(day)), 0);
    this.readingStats.books[filePath] = book;
    return true;
  }
  getReadingStatsGroupFilePaths(groupKey) {
    const normalizedGroupKey = stripSummaryBookSuffix(groupKey.trim());
    return Object.entries(this.readingStats.books).filter(
      ([filePath, book]) => filePath === groupKey || getReadingStatsGroupKey(filePath, book.title) === normalizedGroupKey
    ).map(([filePath]) => filePath);
  }
  async recordReadingStat(record) {
    var _a, _b, _c, _d, _e;
    const timestamp = (_a = record.timestamp) != null ? _a : Date.now();
    const readingMs = this.safeNonNegativeNumber(record.readingMs);
    const readWords = this.safeNonNegativeNumber(record.readWords);
    const hasRange = !!record.countedRange && record.countedRange.end > record.countedRange.start;
    const hasChapterRanges = ((_c = (_b = record.chapterRanges) == null ? void 0 : _b.length) != null ? _c : 0) > 0;
    if (readingMs <= 0 && readWords <= 0 && !hasRange && !hasChapterRanges) return;
    const existing = this.readingStats.books[record.filePath];
    const dayKey = this.getLocalDateKey(timestamp);
    const book = existing != null ? existing : {
      title: record.title,
      totalReadingMs: 0,
      totalReadWords: 0,
      countedRanges: [],
      readChapterRanges: [],
      daily: {},
      lastReadAt: 0
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
    const bookDaily = (_d = book.daily[dayKey]) != null ? _d : { readingMs: 0, readWords: 0, readChapterRanges: [] };
    bookDaily.readingMs += readingMs;
    bookDaily.readWords += readWords;
    if (record.chapterRanges && record.chapterRanges.length > 0) {
      bookDaily.readChapterRanges = this.mergeChapterRanges([...bookDaily.readChapterRanges, ...record.chapterRanges]);
    }
    book.daily[dayKey] = bookDaily;
    book.lastReadAt = Math.max(book.lastReadAt, timestamp);
    this.readingStats.books[record.filePath] = book;
    const daily = (_e = this.readingStats.daily[dayKey]) != null ? _e : { readingMs: 0, readWords: 0, bookPaths: [] };
    daily.readingMs += readingMs;
    daily.readWords += readWords;
    if (!daily.bookPaths.includes(record.filePath)) daily.bookPaths.push(record.filePath);
    this.readingStats.daily[dayKey] = daily;
    await this.savePluginData();
  }
  mergeCountedRanges(ranges) {
    const sorted = ranges.filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start).map((range) => ({ start: Math.floor(range.start), end: Math.floor(range.end) })).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
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
  mergeChapterRanges(ranges) {
    const sorted = ranges.filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end >= range.start).map((range) => ({
      start: Math.floor(range.start),
      end: Math.floor(range.end),
      startTitle: range.startTitle || "\u672A\u8BC6\u522B\u7AE0\u8282",
      endTitle: range.endTitle || range.startTitle || "\u672A\u8BC6\u522B\u7AE0\u8282"
    })).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
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
  getLocalDateKey(timestamp) {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  getEndOfLocalDayTimestamp(date) {
    const [year, month, day] = date.split("-").map((part) => Number(part));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  }
  removeBookContributionFromDaily(date, filePath, readingMs, readWords) {
    var _a;
    const daily = this.readingStats.daily[date];
    if (!daily) return;
    daily.readingMs = Math.max(0, this.safeNonNegativeNumber(daily.readingMs) - this.safeNonNegativeNumber(readingMs));
    daily.readWords = Math.max(0, this.safeNonNegativeNumber(daily.readWords) - this.safeNonNegativeNumber(readWords));
    daily.bookPaths = ((_a = daily.bookPaths) != null ? _a : []).filter((path) => path !== filePath);
    if (daily.readingMs <= 0 && daily.readWords <= 0 && daily.bookPaths.length === 0) {
      delete this.readingStats.daily[date];
    } else {
      this.readingStats.daily[date] = daily;
    }
  }
  async markBookAsRecentlyRead(filePath) {
    var _a, _b;
    const saved = this.progress[filePath];
    this.progress[filePath] = {
      paragraphIndex: (_a = saved == null ? void 0 : saved.paragraphIndex) != null ? _a : 0,
      charOffset: (_b = saved == null ? void 0 : saved.charOffset) != null ? _b : 0,
      lastRead: Date.now()
    };
    await this.savePluginData();
  }
  async saveProgress(filePath, progress) {
    this.progress[filePath] = progress;
    await this.savePluginData();
  }
  getBookSettings(filePath) {
    var _a;
    return (_a = this.bookSettings[filePath]) != null ? _a : {};
  }
  getBookTags(filePath) {
    var _a;
    return normalizeBookTags((_a = this.bookSettings[filePath]) == null ? void 0 : _a.tags);
  }
  getTagCatalog() {
    return normalizeTagCatalog(this.tagCatalog);
  }
  async addTagCatalogItem(group, rawValue) {
    const value = group === "feature" ? normalizeAccumulationTagName(rawValue) : normalizeTagName(rawValue);
    if (!value) return null;
    const next = normalizeTagCatalog(this.tagCatalog);
    next[group] = uniqueNormalizedTags([...next[group], value]);
    this.tagCatalog = next;
    await this.savePluginData();
    return value;
  }
  async saveBookTags(filePath, tags) {
    await this.saveBookSettings(filePath, {
      ...this.getBookSettings(filePath),
      tags: normalizeBookTags(tags)
    });
  }
  async saveBookSettings(filePath, settings) {
    var _a, _b, _c;
    const compact = {};
    if (settings.encoding) compact.encoding = settings.encoding;
    if (settings.firstLineIndent !== void 0) compact.firstLineIndent = settings.firstLineIndent;
    if (settings.tocRegex !== void 0 && settings.tocRegex !== "") compact.tocRegex = settings.tocRegex;
    if (settings.chapterTitleRegex !== void 0 && settings.chapterTitleRegex !== "") {
      compact.chapterTitleRegex = settings.chapterTitleRegex;
    }
    if (settings.prologueTitleRegex !== void 0 && settings.prologueTitleRegex !== "") {
      compact.prologueTitleRegex = settings.prologueTitleRegex;
    }
    if (settings.removeExtraBlankLines !== void 0) {
      compact.removeExtraBlankLines = settings.removeExtraBlankLines;
    }
    if (settings.tocIndentEnabled) {
      compact.tocIndentEnabled = true;
      compact.tocIndentLevel1Regex = ((_a = settings.tocIndentLevel1Regex) == null ? void 0 : _a.trim()) || "\u5377";
      compact.tocIndentLevel2Regex = ((_b = settings.tocIndentLevel2Regex) == null ? void 0 : _b.trim()) || "\u7AE0";
      compact.tocIndentLevel3Regex = ((_c = settings.tocIndentLevel3Regex) == null ? void 0 : _c.trim()) || "\u8282";
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
};
