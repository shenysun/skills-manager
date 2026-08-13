window.SM_DATA = {
  home: "~/.skills-manager",
  skills: [
    { name: "frontend-design", desc: "高辨识度前端界面", category: "frontend-ui", claude: true, agents: true, update: false },
    { name: "langfuse", desc: "观测与评测", category: "observability", claude: true, agents: false, update: true },
    { name: "agent-browser", desc: "浏览器自动化", category: "automation", claude: false, agents: false, update: false },
    { name: "obsidian-bases", desc: "Obsidian Bases", category: "notes", claude: true, agents: false, update: false },
    { name: "excalidraw-diagram-generator", desc: "Excalidraw 图", category: "frontend-ui", claude: false, agents: true, update: false },
    { name: "code-review", desc: "代码审查", category: "engineering", claude: false, agents: false, update: true }
  ],
  sources: [
    { url: "github.com/anthropics/skills", count: 12 },
    { url: "github.com/vercel/skills", count: 4 }
  ]
};
