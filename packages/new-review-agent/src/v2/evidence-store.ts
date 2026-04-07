import type { EvidenceItem } from "./types";

export class EvidenceStore {
  private readonly records = new Map<string, EvidenceItem>();

  private static sourcePriority(source: string): number {
    switch (source) {
      case "diff-changed":
        return 6;
      case "read-changed":
        return 5;
      case "read-skill":
        return 4;
      case "grep-skill":
        return 3;
      case "grep-symbol":
        return 2;
      default:
        return 1;
    }
  }

  private static mergeText(previous: string, incoming: string): string {
    if (!previous.trim()) {
      return incoming;
    }
    if (!incoming.trim() || previous.includes(incoming)) {
      return previous;
    }
    if (incoming.includes(previous)) {
      return incoming;
    }

    return `${previous}\n\n${incoming}`;
  }

  add(item: EvidenceItem): void {
    const existing = this.records.get(item.id);
    if (!existing) {
      this.records.set(item.id, item);
      return;
    }

    const merged: EvidenceItem = {
      ...existing,
      file: existing.file ?? item.file,
      skillName: existing.skillName ?? item.skillName,
      text: EvidenceStore.mergeText(existing.text, item.text),
    };

    this.records.set(item.id, merged);
  }

  addMany(items: EvidenceItem[]): void {
    for (const item of items) {
      this.add(item);
    }
  }

  list(): EvidenceItem[] {
    return Array.from(this.records.values()).sort((a, b) => {
      const bySource =
        EvidenceStore.sourcePriority(b.source) -
        EvidenceStore.sourcePriority(a.source);
      if (bySource !== 0) {
        return bySource;
      }

      const bySkill = (a.skillName ?? "").localeCompare(b.skillName ?? "");
      if (bySkill !== 0) {
        return bySkill;
      }

      const byFile = (a.file ?? "").localeCompare(b.file ?? "");
      if (byFile !== 0) {
        return byFile;
      }

      return a.id.localeCompare(b.id);
    });
  }

  listBySkill(skillName: string): EvidenceItem[] {
    return this.list().filter(
      (item) => item.skillName === skillName || item.skillName === undefined,
    );
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
