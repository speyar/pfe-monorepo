export const REQUEST_SKILL_TOOL_PROMPT = `The requestSkill tool loads the full instructions of a skill by name.

Available skills are listed in the AVAILABLE SKILLS section of your system prompt. Each skill includes a name and use case. When you identify a skill whose use case matches your current task, call this tool with the skill name to load its complete instructions.

The tool returns the skill's description and full markdown content. Follow those instructions as part of your workflow.

Use this tool when:
- You see a skill in AVAILABLE SKILLS whose use case matches the current task
- You need specialized instructions for a particular type of bug or review scenario
- You want to enhance your approach with user-defined best practices

Do NOT use this tool if no skill names match your current task.`;
