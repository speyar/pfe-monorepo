import type { EvidenceItem } from "./types";

export class EvidenceStore {
  private readonly records = new Map<string, EvidenceItem>();

  add(item: EvidenceItem): void {
    if (!this.records.has(item.id)) {
      this.records.set(item.id, item);
    }
  }

  addMany(items: EvidenceItem[]): void {
    for (const item of items) {
      this.add(item);
    }
  }

  list(): EvidenceItem[] {
    return Array.from(this.records.values());
  }

  listBySkill(skillName: string): EvidenceItem[] {
    return this.list().filter((item) => item.skillName === skillName);
  }

  summarize(maxItems: number): string {
    const slice = this.list().slice(0, Math.max(1, maxItems));
    return slice
      .map((item, index) => {
        const file = item.file ? ` file=${item.file}` : "";
        return `${index + 1}. [${item.source}]${file}\n${item.text}`;
      })
      .join("\n\n");
  }
}
