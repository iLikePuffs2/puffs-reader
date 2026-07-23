import { App, PluginSettingTab, Setting, SliderComponent, TextComponent } from 'obsidian';
import PuffsReaderPlugin from './main';
import { DEFAULT_SETTINGS } from './types';

type NumericSettingKey = {
  [K in keyof PuffsReaderPlugin['settings']]: PuffsReaderPlugin['settings'][K] extends number ? K : never;
}[keyof PuffsReaderPlugin['settings']];

export class SettingsTab extends PluginSettingTab {
  plugin: PuffsReaderPlugin;

  constructor(app: App, plugin: PuffsReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h3', { text: '排版设置' });
    this.addNumberSetting('正文字体大小', '阅读区文字大小 (px)', 'fontSize', 12, 36, 1, 'px');
    this.addNumberSetting('行间距', '正文行间距倍数', 'lineHeight', 1, 3.2, 0.1, '倍');
    this.addNumberSetting('段落间距', '段落之间的距离 (px)', 'paragraphSpacing', 0, 48, 1, 'px');
    this.addNumberSetting('首行缩进', '所有书籍默认首行缩进 (em)，单书设置可覆写', 'firstLineIndent', 0, 4, 0.1, 'em');
    this.addNumberSetting('阅读区宽度', '阅读区最大宽度 (px)', 'contentWidth', 360, 1500, 10, 'px');
    this.addNumberSetting('字间距', '文字之间的距离 (px)', 'letterSpacing', 0, 8, 0.1, 'px');
    this.addNumberSetting('正文顶部间距', '正文内容与页面顶部的距离 (px)', 'paddingTop', 0, 180, 1, 'px');
    this.addNumberSetting('正文底部间距', '正文内容与页面底部的距离 (px)', 'paddingBottom', 0, 200, 1, 'px');
    this.addNumberSetting('左侧栏宽度', '目录和全文搜索侧栏宽度 (px)', 'sidebarWidth', 220, 520, 1, 'px');
    this.addNumberSetting('侧栏过渡速度', '目录和全文搜索侧栏展开/收起动画时长 (ms)', 'sidebarTransitionMs', 0, 800, 10, 'ms');
    this.addNumberSetting('目录字体大小', '左侧目录条目的字体大小 (px)', 'tocFontSize', 11, 20, 1, 'px');
    this.addNumberSetting('侧栏书名字号', '侧边栏顶部书名的字号 (px)', 'sidebarTitleFontSize', 11, 28, 1, 'px');

    this.addTextSetting('字体颜色', 'RGB 格式，如 51,51,51。留空跟随主题。', 'fontColor', '例如 51,51,51');
    this.addTextSetting('书籍背景颜色', 'RGB 格式，如 233,216,188。留空跟随主题。', 'backgroundColor', '例如 233,216,188');

    containerEl.createEl('h3', { text: '顶部章名与底部进度' });
    this.addNumberSetting('章名字号', '页面顶部章名小字大小 (px)', 'chapterMetaFontSize', 9, 20, 1, 'px');
    this.addNumberSetting('章名顶部位置', '章名距离页面顶部的位置 (px)', 'chapterMetaTop', 0, 80, 1, 'px');
    this.addTextSetting('章名颜色', 'RGB 格式；留空使用主题弱化文字颜色。', 'chapterMetaColor', '例如 120,120,120');
    this.addNumberSetting('进度字号', '页面底部百分比小字大小 (px)', 'progressMetaFontSize', 9, 20, 1, 'px');
    this.addNumberSetting('进度底部位置', '百分比距离页面底部的位置 (px)', 'progressMetaBottom', 0, 80, 1, 'px');
    this.addTextSetting('进度颜色', 'RGB 格式；留空使用主题弱化文字颜色。', 'progressMetaColor', '例如 120,120,120');

    containerEl.createEl('h3', { text: '功能开关' });
    new Setting(containerEl)
      .setName('显示阅读进度')
      .setDesc('在页面底部显示阅读百分比')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showProgress).onChange(async (v) => {
          this.plugin.settings.showProgress = v;
          await this.plugin.savePluginData();
          this.refreshOpenReaders();
        }),
      );

    new Setting(containerEl)
      .setName('显示顶部章名')
      .setDesc('在阅读区顶部显示当前章节名')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showChapterTitle).onChange(async (v) => {
          this.plugin.settings.showChapterTitle = v;
          await this.plugin.savePluginData();
          this.refreshOpenReaders();
        }),
      );

    new Setting(containerEl)
      .setName('去除多余空行')
      .setDesc('自动清理 TXT 中连续的空白行')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.removeExtraBlankLines).onChange(async (v) => {
          this.plugin.settings.removeExtraBlankLines = v;
          await this.plugin.savePluginData();
          this.refreshOpenReaders();
        }),
      );

    this.addNumberSetting('鼠标隐藏延迟', '阅读器标签页激活时，鼠标静止多久后隐藏光标。设为 0 则不自动隐藏。', 'cursorHideDelayMs', 0, 10000, 100, 'ms');
    this.addNumberSetting('每秒手动翻页速度上限', '按键盘方向键翻页时，每秒最多允许翻过的页数。', 'manualPageTurnsPerSecond', 1, 20, 1, '页/秒');

    containerEl.createEl('h3', { text: '阅读统计' });
    this.addNumberSettingInMinutes(
      '阅读计时空闲截止',
      '在同一页停留超过多久后，停止继续累计阅读时长，直到下一次翻页或跳转。',
      'readingStatsIdleLimitMs',
      1,
      60,
      1,
      'min',
    );

    containerEl.createEl('h3', { text: '目录与编码' });
    this.addTextSetting('目录匹配正则', '所有书籍默认章节匹配正则；单书设置可覆写。', 'tocRegex', DEFAULT_SETTINGS.tocRegex);
    this.addTextSetting('章名提取正则', '从章节行中提取显示标题的正则（需含捕获组）；单书设置可覆写。', 'chapterTitleRegex', DEFAULT_SETTINGS.chapterTitleRegex);
    this.addTextSetting('序章匹配名称', '匹配序章、前言、楔子等不带“第几章”的标题；单书设置可覆写。', 'prologueTitleRegex', DEFAULT_SETTINGS.prologueTitleRegex);

    new Setting(containerEl)
      .setName('默认编码')
      .setDesc('打开文件时的默认编码（自动检测失败时使用）')
      .addDropdown((dd) =>
        dd
          .addOptions({
            'utf-8': 'UTF-8',
            gbk: 'GBK',
            gb18030: 'GB18030',
            big5: 'Big5',
          })
          .setValue(this.plugin.settings.defaultEncoding)
          .onChange(async (v) => {
            this.plugin.settings.defaultEncoding = v;
            await this.plugin.savePluginData();
            this.refreshOpenReaders();
          }),
      );

    this.addTextSetting(
      '全文搜索快捷键',
      '默认 Ctrl+F。支持 Ctrl/Alt/Shift 加单个按键，例如 Ctrl+Shift+F。',
      'searchHotkey',
      DEFAULT_SETTINGS.searchHotkey,
    );

    this.addTextSetting(
      '目录面板快捷键',
      '默认 Ctrl+B。用于弹出/收起左侧目录侧边栏。',
      'tocPanelHotkey',
      DEFAULT_SETTINGS.tocPanelHotkey,
    );

    this.addTextSetting(
      '单书配置快捷键',
      '默认 Ctrl+;。阅读书籍时用于打开/收起单书设置浮层。',
      'bookSettingsHotkey',
      DEFAULT_SETTINGS.bookSettingsHotkey,
    );

    this.addTextSetting(
      '拆分文本快捷键',
      '默认 Ctrl+Shift+C。选择起止章节后，将对应原文拆分并保存为 TXT 文件。',
      'copySourceHotkey',
      DEFAULT_SETTINGS.copySourceHotkey,
    );

    this.addTextSetting(
      '拆书文本目录',
      'vault 内相对路径。复制章节原文时，会按书名创建子文件夹并保存 TXT 文件。',
      'breakdownTextDir',
      DEFAULT_SETTINGS.breakdownTextDir,
    );

    this.addTextSetting(
      '上一页快捷键',
      '默认 j。除左方向键外，用于向前翻页的自定义按键。支持 Ctrl/Alt/Shift 加单个按键。',
      'previousPageHotkey',
      DEFAULT_SETTINGS.previousPageHotkey,
    );

    this.addTextSetting(
      '下一页快捷键',
      '默认 l。除右方向键外，用于向后翻页的自定义按键。支持 Ctrl/Alt/Shift 加单个按键。',
      'nextPageHotkey',
      DEFAULT_SETTINGS.nextPageHotkey,
    );

    containerEl.createEl('h3', { text: '标注与批注' });
    this.addTextSetting(
      '标注高亮颜色',
      'RGB 格式，如 255,200,50。留空则跟随浏览器选区色。',
      'annotationHighlightColor',
      '例如 255,200,50',
    );
    this.addTextSetting(
      '导出目录',
      'vault 内相对路径；留空则导出到根目录。文件名固定为「书名.md」。',
      'annotationExportDir',
      '例如 阅读笔记',
    );

    new Setting(containerEl)
      .setName('导出后删除对应笔记')
      .setDesc('导出一本书的 Markdown 笔记成功后，删除该书已导出的标注与批注。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.deleteAnnotationsAfterExport).onChange(async (v) => {
          this.plugin.settings.deleteAnnotationsAfterExport = v;
          await this.plugin.savePluginData();
          this.refreshOpenReaders();
        }),
      );

    containerEl.createEl('h3', { text: '书库 Git 同步' });
    new Setting(containerEl)
      .setName('书库目录')
      .setDesc('存放小说 TXT 文件的目录路径（绝对路径或相对于 vault 的路径）。插件启动 10 秒后扫描文件变化，有变动则自动执行 git add / commit / push。留空禁用。')
      .addText((text) =>
        text
          .setPlaceholder('例如 D:\\novels 或 novels')
          .setValue(this.plugin.settings.bookLibraryPath)
          .onChange(async (v) => {
            this.plugin.settings.bookLibraryPath = v.trim();
            await this.plugin.savePluginData();
            this.plugin.scheduleBookLibraryScan();
          }),
      );

    containerEl.createEl('h3', { text: '数据备份' });
    this.addTextSetting(
      '备份路径',
      'data.json 的备份目录或文件路径；支持 vault 内相对路径或本机绝对路径。留空则备份到插件目录 data.backup.json。',
      'dataBackupPath',
      '.obsidian/plugins/puffs-reader/data.backup.json',
    );
    this.addNumberSetting('备份频率', '每隔多少小时自动覆盖备份一次 data.json。', 'dataBackupFrequencyHours', 1, 720, 1, '小时');

    containerEl.createEl('h3', { text: '书架相关' });
    this.addTextSetting(
      '搜索书名快捷键',
      '默认 Ctrl+F。用于在书架页弹出/收起书名搜索框。支持 Ctrl/Alt/Shift 加单个按键。',
      'bookshelfTitleSearchHotkey',
      DEFAULT_SETTINGS.bookshelfTitleSearchHotkey,
    );
    this.addTextSetting(
      '选择作者快捷键',
      '默认 Ctrl+Alt+F。用于在书架页选中/取消作者搜索，并弹出/收起搜索框。',
      'bookshelfAuthorSearchHotkey',
      DEFAULT_SETTINGS.bookshelfAuthorSearchHotkey,
    );
  }

  private addNumberSetting(
    name: string,
    desc: string,
    key: NumericSettingKey,
    min: number,
    max: number,
    step: number,
    unit: string,
  ): void {
    let sliderControl: SliderComponent | null = null;
    let textControl: TextComponent | null = null;
    let isSyncing = false;

    const clamp = (value: number): number => Math.min(max, Math.max(min, value));
    const format = (value: number): string => String(value);
    const save = async (value: number, syncText: boolean): Promise<void> => {
      const next = clamp(value);
      this.plugin.settings[key] = next;
      isSyncing = true;
      sliderControl?.setValue(next);
      if (syncText) textControl?.setValue(format(next));
      isSyncing = false;
      await this.plugin.savePluginData();
      this.refreshOpenReaders();
    };

    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addSlider((slider) =>
        (sliderControl = slider)
          .setLimits(min, max, step)
          .setValue(this.plugin.settings[key])
          .setDynamicTooltip()
          .onChange((v) => {
            if (isSyncing) return;
            save(v, true);
          }),
      )
      .addText((text) => {
        textControl = text;
        const unitEl = document.createElement('span');
        unitEl.className = 'puffs-setting-unit';
        unitEl.textContent = unit;
        text.inputEl.insertAdjacentElement('afterend', unitEl);
        return text
          .setValue(String(this.plugin.settings[key]))
          .setPlaceholder(unit)
          .onChange((v) => {
            if (isSyncing) return;
            const n = Number(v);
            if (Number.isNaN(n)) return;
            // 输入框编辑中只同步滑块和预览，不回写文本框，避免用户输入 900 时刚键入 9 就被夹到 360。
            save(n, false);
          });
      });
  }

  private addNumberSettingInMinutes(
    name: string,
    desc: string,
    key: NumericSettingKey,
    min: number,
    max: number,
    step: number,
    unit: string,
  ): void {
    let sliderControl: SliderComponent | null = null;
    let textControl: TextComponent | null = null;
    let isSyncing = false;

    const toMinutes = (valueMs: number): number => Math.round(valueMs / 60000);
    const clamp = (value: number): number => Math.min(max, Math.max(min, value));
    const save = async (valueMinutes: number, syncText: boolean): Promise<void> => {
      const nextMinutes = clamp(valueMinutes);
      this.plugin.settings[key] = nextMinutes * 60000;
      isSyncing = true;
      sliderControl?.setValue(nextMinutes);
      if (syncText) textControl?.setValue(String(nextMinutes));
      isSyncing = false;
      await this.plugin.savePluginData();
      this.refreshOpenReaders();
    };
    const currentMinutes = clamp(toMinutes(Number(this.plugin.settings[key])));

    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addSlider((slider) =>
        (sliderControl = slider)
          .setLimits(min, max, step)
          .setValue(currentMinutes)
          .setDynamicTooltip()
          .onChange((v) => {
            if (isSyncing) return;
            save(v, true);
          }),
      )
      .addText((text) => {
        textControl = text;
        const unitEl = document.createElement('span');
        unitEl.className = 'puffs-setting-unit';
        unitEl.textContent = unit;
        text.inputEl.insertAdjacentElement('afterend', unitEl);
        return text
          .setValue(String(currentMinutes))
          .setPlaceholder(unit)
          .onChange((v) => {
            if (isSyncing) return;
            const n = Number(v);
            if (Number.isNaN(n)) return;
            save(n, false);
          });
      });
  }

  private addTextSetting(
    name: string,
    desc: string,
    key: 'fontColor' | 'backgroundColor' | 'chapterMetaColor' | 'progressMetaColor' | 'tocRegex' | 'chapterTitleRegex' | 'prologueTitleRegex' | 'searchHotkey' | 'tocPanelHotkey' | 'bookSettingsHotkey' | 'copySourceHotkey' | 'bookshelfTitleSearchHotkey' | 'bookshelfAuthorSearchHotkey' | 'breakdownTextDir' | 'previousPageHotkey' | 'nextPageHotkey' | 'annotationHighlightColor' | 'annotationExportDir' | 'dataBackupPath',
    placeholder: string,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings[key])
          .onChange(async (v) => {
            const fallback =
              key === 'searchHotkey' ? DEFAULT_SETTINGS.searchHotkey :
              key === 'tocPanelHotkey' ? DEFAULT_SETTINGS.tocPanelHotkey :
              key === 'bookSettingsHotkey' ? DEFAULT_SETTINGS.bookSettingsHotkey :
              key === 'copySourceHotkey' ? DEFAULT_SETTINGS.copySourceHotkey :
              key === 'bookshelfTitleSearchHotkey' ? DEFAULT_SETTINGS.bookshelfTitleSearchHotkey :
              key === 'bookshelfAuthorSearchHotkey' ? DEFAULT_SETTINGS.bookshelfAuthorSearchHotkey :
              key === 'breakdownTextDir' ? DEFAULT_SETTINGS.breakdownTextDir :
              key === 'previousPageHotkey' ? DEFAULT_SETTINGS.previousPageHotkey :
              key === 'nextPageHotkey' ? DEFAULT_SETTINGS.nextPageHotkey :
              key === 'chapterTitleRegex' ? DEFAULT_SETTINGS.chapterTitleRegex :
              key === 'prologueTitleRegex' ? DEFAULT_SETTINGS.prologueTitleRegex :
              '';
            this.plugin.settings[key] = v.trim() || fallback;
            await this.plugin.savePluginData();
            this.refreshOpenReaders();
          }),
      );
  }

  private refreshOpenReaders(): void {
    for (const leaf of this.app.workspace.getLeavesOfType('puffs-reader-view')) {
      const view = leaf.view as unknown as { refreshSettingsFromGlobal?: () => void };
      view.refreshSettingsFromGlobal?.();
    }
  }
}
