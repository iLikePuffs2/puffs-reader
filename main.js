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
  removeExtraBlankLines: true,
  cursorHideDelayMs: 2e3,
  manualPageTurnsPerSecond: 4,
  previousPageHotkey: "j",
  nextPageHotkey: "l",
  tocRegex: DEFAULT_TOC_REGEX,
  chapterTitleRegex: DEFAULT_CHAPTER_TITLE_REGEX,
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
  bookLibraryPath: ""
};

// src/ReaderView.ts
var READER_VIEW_TYPE = "puffs-reader-view";
var ReaderView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.filePath = "";
    this.currentFile = null;
    this.fileBuffer = null;
    this.currentEncoding = "utf-8";
    this.paragraphs = [];
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
    this.renderCurrentPage();
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
          this.focusReader();
          this.resetCursorIdleState();
        } else {
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
    const { text } = this.decodeBuffer(this.fileBuffer, encoding);
    this.currentEncoding = encoding;
    this.paragraphs = this.processText(text);
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
    if (this.plugin.settings.removeExtraBlankLines) {
      lines = lines.filter((line) => line.trim() !== "");
    }
    lines = this.removeBlankLinesAfterChapter(lines);
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    return lines;
  }
  /** 章节标题后面的空行只会拉开章节名和正文第一段，这里直接清理掉。 */
  removeBlankLinesAfterChapter(lines) {
    const tocRegexText = this.getEffectiveTocRegex();
    if (!tocRegexText) return lines;
    let tocRegex;
    try {
      tocRegex = new RegExp(tocRegexText);
    } catch (e) {
      return lines;
    }
    const cleaned = [];
    let previousWasChapter = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (previousWasChapter && trimmed === "") continue;
      cleaned.push(line);
      previousWasChapter = trimmed !== "" && tocRegex.test(trimmed);
    }
    return cleaned;
  }
  renderCurrentPage() {
    if (this.paragraphs.length === 0) {
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
  parseChapters() {
    this.chapters = [];
    this.collapsedTocGroups.clear();
    const tocRegexText = this.getEffectiveTocRegex();
    if (!tocRegexText) return;
    let regex;
    try {
      regex = new RegExp(tocRegexText);
    } catch (e) {
      return;
    }
    for (let i = 0; i < this.paragraphs.length; i++) {
      const line = this.paragraphs[i].trim();
      if (line && regex.test(line)) {
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
    var _a, _b;
    const settings = this.getBookSettings();
    if (!settings.tocIndentEnabled) return 1;
    const marker = this.extractChapterMarker(line);
    if (!marker) return 1;
    try {
      const level1Regex = new RegExp(((_a = settings.tocIndentLevel1Regex) == null ? void 0 : _a.trim()) || "\u5377");
      const level2Regex = new RegExp(((_b = settings.tocIndentLevel2Regex) == null ? void 0 : _b.trim()) || "\u7AE0");
      if (level1Regex.test(marker)) return 1;
      if (level2Regex.test(marker)) return 2;
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
    var _a, _b, _c;
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
      if (ch.level === 2 && this.isTocChildHidden(index)) return;
      const item = this.tocListEl.createDiv({ cls: "puffs-toc-item" });
      item.dataset.chapterIndex = String(index);
      item.classList.add(ch.level === 2 ? "puffs-toc-level-2" : "puffs-toc-level-1");
      if (ch.level === 1 && this.hasTocChildren(index)) {
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
    for (let i = index + 1; i < this.chapters.length; i++) {
      if (this.chapters[i].level === 1) return false;
      if (this.chapters[i].level === 2) return true;
    }
    return false;
  }
  isTocChildHidden(index) {
    const parentIndex = this.getTocParentIndex(index);
    return parentIndex !== null && this.collapsedTocGroups.has(parentIndex);
  }
  getTocParentIndex(index) {
    for (let i = index - 1; i >= 0; i--) {
      if (this.chapters[i].level === 1) return i;
    }
    return null;
  }
  toggleTocGroup(index) {
    if (this.collapsedTocGroups.has(index)) this.collapsedTocGroups.delete(index);
    else this.collapsedTocGroups.add(index);
    this.buildTocList();
    this.highlightCurrentTocItem(this.getActiveChapterIndex(this.currentPageStart.paraIndex));
  }
  updatePageMeta() {
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    this.chapterTitleEl.textContent = activeChapter >= 0 ? this.chapters[activeChapter].title : "";
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
    var _a, _b;
    const visibleIdx = this.isTocChildHidden(idx) ? (_a = this.getTocParentIndex(idx)) != null ? _a : idx : idx;
    (_b = this.tocListEl) == null ? void 0 : _b.querySelectorAll(".puffs-toc-item").forEach((el) => {
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
    this.tocTitleEl.textContent = inSearch ? "\u5168\u4E66\u641C\u7D22" : (_b = (_a = this.currentFile) == null ? void 0 : _a.basename) != null ? _b : "\u76EE\u5F55";
    (0, import_obsidian.setIcon)(this.tocModeBtn, inSearch ? "list" : "search");
    this.tocModeBtn.setAttribute("aria-label", inSearch ? "\u8FD4\u56DE\u76EE\u5F55" : "\u5168\u4E66\u641C\u7D22");
    this.tocModeBtn.removeAttribute("title");
    this.tocTabsEl.classList.toggle("puffs-hidden", inSearch);
    this.tocTabBtn.classList.toggle("puffs-toc-tab-active", mode === "toc");
    this.notesTabBtn.classList.toggle("puffs-toc-tab-active", mode === "notes");
    this.tocListEl.classList.toggle("puffs-hidden", mode !== "toc");
    this.notesPaneEl.classList.toggle("puffs-hidden", mode !== "notes");
    this.searchPaneEl.classList.toggle("puffs-hidden", mode !== "search");
  }
  updateSidebarTitle() {
    var _a, _b;
    if (!this.tocTitleEl || this.sidebarMode === "search") return;
    this.tocTitleEl.textContent = (_b = (_a = this.currentFile) == null ? void 0 : _a.basename) != null ? _b : "\u76EE\u5F55";
  }
  scrollTocToActiveChapter() {
    var _a;
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    if (activeChapter < 0) return;
    const visibleChapter = this.isTocChildHidden(activeChapter) ? (_a = this.getTocParentIndex(activeChapter)) != null ? _a : activeChapter : activeChapter;
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
    var _a;
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
  addTocIndentRows(parent, bookSettings) {
    var _a, _b;
    const enabled = !!bookSettings.tocIndentEnabled;
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: "\u4E8C\u7EA7\u7F29\u8FDB" });
    const toggle = row.createEl("input", {
      cls: "puffs-typo-toggle",
      attr: { type: "checkbox" }
    });
    toggle.checked = enabled;
    toggle.addEventListener("change", () => {
      var _a2, _b2;
      this.updateBookSettings({
        tocIndentEnabled: toggle.checked,
        tocIndentLevel1Regex: toggle.checked ? ((_a2 = bookSettings.tocIndentLevel1Regex) == null ? void 0 : _a2.trim()) || "\u5377" : void 0,
        tocIndentLevel2Regex: toggle.checked ? ((_b2 = bookSettings.tocIndentLevel2Regex) == null ? void 0 : _b2.trim()) || "\u7AE0" : void 0
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
    if (this.chapters.length === 0) {
      new import_obsidian.Notice("\u672A\u68C0\u6D4B\u5230\u53EF\u590D\u5236\u7684\u7AE0\u8282");
      return;
    }
    const currentChapter = Math.max(0, this.getActiveChapterIndex(this.currentPageStart.paraIndex));
    const modal = new ChapterRangeCopyModal(
      this.app,
      this.chapters,
      currentChapter,
      async (startIndex, endIndex) => this.copyChapterRange(startIndex, endIndex),
      () => {
        if (this.chapterCopyModal === modal) this.chapterCopyModal = null;
      }
    );
    this.chapterCopyModal = modal;
    modal.open();
  }
  async copyChapterRange(startIndex, endIndex) {
    var _a, _b;
    const start = this.chapters[startIndex];
    const end = this.chapters[endIndex];
    if (!start || !end) {
      new import_obsidian.Notice("\u590D\u5236\u5931\u8D25\uFF1A\u7AE0\u8282\u8303\u56F4\u65E0\u6548");
      return false;
    }
    if (endIndex < startIndex) {
      new import_obsidian.Notice("\u7ED3\u675F\u7AE0\u8282\u4E0D\u80FD\u65E9\u4E8E\u8D77\u59CB\u7AE0\u8282");
      return false;
    }
    const endParaIndex = (_b = (_a = this.chapters[endIndex + 1]) == null ? void 0 : _a.startParaIndex) != null ? _b : this.paragraphs.length;
    const text = this.paragraphs.slice(start.startParaIndex, endParaIndex).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      new import_obsidian.Notice("\u590D\u5236\u5931\u8D25\uFF1A\u65E0\u6CD5\u5199\u5165\u526A\u8D34\u677F");
      return false;
    }
    if (!this.currentFile) {
      new import_obsidian.Notice("\u4FDD\u5B58\u5931\u8D25\uFF1A\u5F53\u524D\u4E66\u7C4D\u6587\u4EF6\u65E0\u6548");
      return false;
    }
    try {
      const baseDir = (this.plugin.settings.breakdownTextDir || DEFAULT_SETTINGS.breakdownTextDir).trim().replace(/^\/+|\/+$/g, "");
      const bookName = this.sanitizePathComponent(this.currentFile.basename);
      const targetDir = (0, import_obsidian.normalizePath)(baseDir ? `${baseDir}/${bookName}` : bookName);
      await this.ensureVaultFolder(targetDir);
      const startTitle = this.sanitizePathComponent(start.title);
      const endTitle = this.sanitizePathComponent(end.title);
      const fileName = `${bookName}-${startTitle}-${endTitle}.txt`;
      await this.app.vault.adapter.write((0, import_obsidian.normalizePath)(`${targetDir}/${fileName}`), text);
      return true;
    } catch (e) {
      new import_obsidian.Notice("\u4FDD\u5B58\u5931\u8D25\uFF1A\u65E0\u6CD5\u521B\u5EFA\u62C6\u4E66\u6587\u672C\u6587\u4EF6");
      return false;
    }
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
var ChapterInputSuggest = class extends import_obsidian.AbstractInputSuggest {
  constructor(app, inputEl, chapters, preferredIndex) {
    super(app, inputEl);
    this.choices = chapters.map((chapter, index) => ({ chapter, index }));
    this.preferredIndex = preferredIndex;
    this.limit = 100;
  }
  setPreferredIndex(index) {
    this.preferredIndex = index;
  }
  getSuggestions(query) {
    const normalized = query.trim();
    if (!normalized) {
      return [...this.choices].sort((a, b) => {
        if (a.index === this.preferredIndex) return -1;
        if (b.index === this.preferredIndex) return 1;
        return a.index - b.index;
      });
    }
    const search = (0, import_obsidian.prepareFuzzySearch)(normalized);
    return this.choices.map((choice) => ({
      choice,
      match: search(`${choice.chapter.title} ${choice.chapter.rawTitle}`)
    })).filter((item) => item.match !== null).sort((a, b) => {
      var _a, _b, _c, _d;
      return ((_b = (_a = b.match) == null ? void 0 : _a.score) != null ? _b : 0) - ((_d = (_c = a.match) == null ? void 0 : _c.score) != null ? _d : 0);
    }).map((item) => item.choice);
  }
  renderSuggestion(choice, el) {
    el.createDiv({ cls: "puffs-chapter-copy-suggestion", text: choice.chapter.title });
  }
};
var ChapterRangeCopyModal = class extends import_obsidian.Modal {
  constructor(app, chapters, initialChapterIndex, onCopy, onDismiss) {
    super(app);
    this.startIndex = null;
    this.chapters = chapters;
    this.initialChapterIndex = initialChapterIndex;
    this.onCopy = onCopy;
    this.onDismiss = onDismiss;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass("puffs-chapter-copy-modal");
    this.headingEl = contentEl.createEl("h3", {
      cls: "puffs-chapter-copy-title",
      text: "\u9009\u62E9\u8D77\u59CB\u7AE0\u8282"
    });
    this.selectedEl = contentEl.createDiv({ cls: "puffs-chapter-copy-selected puffs-hidden" });
    this.inputEl = contentEl.createEl("input", {
      cls: "puffs-chapter-copy-input",
      attr: {
        type: "text",
        placeholder: "\u8F93\u5165\u7AE0\u8282\u6807\u9898\u8FDB\u884C\u641C\u7D22",
        autocomplete: "off"
      }
    });
    this.suggest = new ChapterInputSuggest(
      this.app,
      this.inputEl,
      this.chapters,
      this.initialChapterIndex
    );
    this.suggest.onSelect((choice) => void this.selectChapter(choice));
    window.setTimeout(() => {
      this.inputEl.focus();
      this.suggest.open();
    }, 0);
  }
  async selectChapter(choice) {
    if (this.startIndex === null) {
      this.startIndex = choice.index;
      this.headingEl.textContent = "\u9009\u62E9\u7ED3\u675F\u7AE0\u8282";
      this.selectedEl.textContent = `\u8D77\u59CB\uFF1A${choice.chapter.title}`;
      this.selectedEl.classList.remove("puffs-hidden");
      this.inputEl.value = "";
      this.inputEl.placeholder = "\u8F93\u5165\u7ED3\u675F\u7AE0\u8282\u6807\u9898";
      this.suggest.setPreferredIndex(choice.index);
      this.suggest.setValue("");
      window.setTimeout(() => {
        this.inputEl.focus();
        this.suggest.open();
      }, 0);
      return;
    }
    if (choice.index < this.startIndex) {
      new import_obsidian.Notice("\u7ED3\u675F\u7AE0\u8282\u4E0D\u80FD\u65E9\u4E8E\u8D77\u59CB\u7AE0\u8282");
      this.inputEl.value = "";
      this.suggest.setValue("");
      window.setTimeout(() => {
        this.inputEl.focus();
        this.suggest.open();
      }, 0);
      return;
    }
    const copied = await this.onCopy(this.startIndex, choice.index);
    if (copied) {
      this.close();
    } else {
      this.inputEl.focus();
      this.suggest.open();
    }
  }
  onClose() {
    var _a;
    (_a = this.suggest) == null ? void 0 : _a.close();
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
    new import_obsidian2.Setting(containerEl).setName("\u53BB\u9664\u591A\u4F59\u7A7A\u884C").setDesc("\u81EA\u52A8\u6E05\u7406 TXT \u4E2D\u8FDE\u7EED\u7684\u7A7A\u767D\u884C").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.removeExtraBlankLines).onChange(async (v) => {
        this.plugin.settings.removeExtraBlankLines = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    this.addNumberSetting("\u9F20\u6807\u9690\u85CF\u5EF6\u8FDF", "\u9605\u8BFB\u5668\u6807\u7B7E\u9875\u6FC0\u6D3B\u65F6\uFF0C\u9F20\u6807\u9759\u6B62\u591A\u4E45\u540E\u9690\u85CF\u5149\u6807\u3002\u8BBE\u4E3A 0 \u5219\u4E0D\u81EA\u52A8\u9690\u85CF\u3002", "cursorHideDelayMs", 0, 1e4, 100, "ms");
    this.addNumberSetting("\u6BCF\u79D2\u624B\u52A8\u7FFB\u9875\u901F\u5EA6\u4E0A\u9650", "\u6309\u952E\u76D8\u65B9\u5411\u952E\u7FFB\u9875\u65F6\uFF0C\u6BCF\u79D2\u6700\u591A\u5141\u8BB8\u7FFB\u8FC7\u7684\u9875\u6570\u3002", "manualPageTurnsPerSecond", 1, 20, 1, "\u9875/\u79D2");
    containerEl.createEl("h3", { text: "\u76EE\u5F55\u4E0E\u7F16\u7801" });
    this.addTextSetting("\u76EE\u5F55\u5339\u914D\u6B63\u5219", "\u6240\u6709\u4E66\u7C4D\u9ED8\u8BA4\u7AE0\u8282\u5339\u914D\u6B63\u5219\uFF1B\u5355\u4E66\u8BBE\u7F6E\u53EF\u8986\u5199\u3002", "tocRegex", DEFAULT_SETTINGS.tocRegex);
    this.addTextSetting("\u7AE0\u540D\u63D0\u53D6\u6B63\u5219", "\u4ECE\u7AE0\u8282\u884C\u4E2D\u63D0\u53D6\u663E\u793A\u6807\u9898\u7684\u6B63\u5219\uFF08\u9700\u542B\u6355\u83B7\u7EC4\uFF09\uFF1B\u5355\u4E66\u8BBE\u7F6E\u53EF\u8986\u5199\u3002", "chapterTitleRegex", DEFAULT_SETTINGS.chapterTitleRegex);
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
      "\u590D\u5236\u539F\u6587\u5FEB\u6377\u952E",
      "\u9ED8\u8BA4 Ctrl+Shift+C\u3002\u4F9D\u6B21\u9009\u62E9\u8D77\u59CB\u548C\u7ED3\u675F\u7AE0\u8282\uFF0C\u5C06\u5BF9\u5E94\u539F\u6587\u590D\u5236\u5230\u526A\u8D34\u677F\u3002",
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
    ).addText(
      (text) => (textControl = text).setValue(String(this.plugin.settings[key])).setPlaceholder(unit).onChange((v) => {
        if (isSyncing) return;
        const n = Number(v);
        if (Number.isNaN(n)) return;
        save(n, false);
      })
    );
  }
  addTextSetting(name, desc, key, placeholder) {
    new import_obsidian2.Setting(this.containerEl).setName(name).setDesc(desc).addText(
      (text) => text.setPlaceholder(placeholder).setValue(this.plugin.settings[key]).onChange(async (v) => {
        const fallback = key === "searchHotkey" ? DEFAULT_SETTINGS.searchHotkey : key === "tocPanelHotkey" ? DEFAULT_SETTINGS.tocPanelHotkey : key === "copySourceHotkey" ? DEFAULT_SETTINGS.copySourceHotkey : key === "breakdownTextDir" ? DEFAULT_SETTINGS.breakdownTextDir : key === "previousPageHotkey" ? DEFAULT_SETTINGS.previousPageHotkey : key === "nextPageHotkey" ? DEFAULT_SETTINGS.nextPageHotkey : key === "chapterTitleRegex" ? DEFAULT_SETTINGS.chapterTitleRegex : "";
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
var PuffsReaderPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.progress = {};
    this.bookSettings = {};
    this.lastDataBackupAt = 0;
    this.knownBooks = [];
    this.dataBackupTimer = null;
    this.bookScanTimer = null;
  }
  async onload() {
    await this.loadPluginData();
    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));
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
  // ═══════════════════════════ 数据持久化 ═══════════════════════════
  async loadPluginData() {
    var _a, _b, _c, _d, _e;
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data == null ? void 0 : data.settings);
    this.progress = (_a = data == null ? void 0 : data.progress) != null ? _a : {};
    this.bookSettings = (_b = data == null ? void 0 : data.bookSettings) != null ? _b : {};
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
      lastDataBackupAt: this.lastDataBackupAt,
      knownBooks: this.knownBooks
    });
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
  async saveBookSettings(filePath, settings) {
    var _a, _b;
    const compact = {};
    if (settings.encoding) compact.encoding = settings.encoding;
    if (settings.firstLineIndent !== void 0) compact.firstLineIndent = settings.firstLineIndent;
    if (settings.tocRegex !== void 0 && settings.tocRegex !== "") compact.tocRegex = settings.tocRegex;
    if (settings.chapterTitleRegex !== void 0 && settings.chapterTitleRegex !== "") {
      compact.chapterTitleRegex = settings.chapterTitleRegex;
    }
    if (settings.tocIndentEnabled) {
      compact.tocIndentEnabled = true;
      compact.tocIndentLevel1Regex = ((_a = settings.tocIndentLevel1Regex) == null ? void 0 : _a.trim()) || "\u5377";
      compact.tocIndentLevel2Regex = ((_b = settings.tocIndentLevel2Regex) == null ? void 0 : _b.trim()) || "\u7AE0";
    }
    if (settings.annotations && settings.annotations.length > 0) {
      compact.annotations = settings.annotations;
    }
    this.bookSettings[filePath] = compact;
    await this.savePluginData();
  }
};
