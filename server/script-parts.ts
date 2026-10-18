export type ScriptPart = { title: string; text: string };

const MAX_PART_CHARS = 4_000;

function chunk(part: ScriptPart): ScriptPart[] {
  const paragraphs = part.text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > MAX_PART_CHARS) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph.trim()}` : paragraph.trim();
  }
  if (current) chunks.push(current);
  return chunks.map((text, index) => ({
    title: index ? `${part.title} (${index + 1})` : part.title,
    text,
  }));
}

export function splitScript(script: string): ScriptPart[] {
  const sections: ScriptPart[] = [];
  let current: ScriptPart = { title: "Opening", text: "" };
  for (const line of script.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)/);
    if (heading) {
      if (current.text.trim()) sections.push(current);
      current = { title: heading[1].replace(/\*/g, "").trim(), text: "" };
    } else {
      current.text += `${line.replace(/\*\*/g, "")}\n`;
    }
  }
  if (current.text.trim()) sections.push(current);
  return sections.flatMap((section) => {
    const spoken = /^\s*HOST_[AB]:/im.test(section.text)
      ? section
      : { ...section, text: `${section.title}.\n\n${section.text}` };
    return chunk(spoken);
  });
}
