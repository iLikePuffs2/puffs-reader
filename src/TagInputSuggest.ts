import { AbstractInputSuggest, App } from 'obsidian';

export class TagInputSuggest extends AbstractInputSuggest<string> {
  private values: string[];

  constructor(app: App, inputEl: HTMLInputElement, values: string[], onChoose: (value: string) => void) {
    super(app, inputEl);
    this.values = this.normalizeValues(values);
    this.limit = 40;
    this.onSelect((value) => {
      this.setValue(value);
      onChoose(value);
    });
  }

  protected getSuggestions(query: string): string[] {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = normalizedQuery
      ? this.values.filter((value) => value.toLowerCase().includes(normalizedQuery))
      : this.values;
    return matches.sort((a, b) => this.getRank(a, normalizedQuery) - this.getRank(b, normalizedQuery)
      || a.localeCompare(b, 'zh-CN', { numeric: true }));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.createDiv({ cls: 'puffs-tag-suggest-item', text: value });
  }

  private normalizeValues(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
      const value = raw.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  }

  private getRank(value: string, query: string): number {
    if (!query) return 0;
    const normalized = value.toLowerCase();
    if (normalized === query) return 0;
    if (normalized.startsWith(query)) return 1;
    return 2;
  }
}
