import readline from 'node:readline';

export type SelectOption = {
  id: string;
  label: string;
  /** Dim trailing detail (e.g. the runtime dir the agent loads). */
  detail?: string;
};

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * Minimal TTY multi-select (the CLI's only interactive moment — ADR-0014):
 * ↑/↓ move, space toggles, `a` toggles all, enter confirms, ctrl-c aborts.
 * Returns the selected ids; all options start checked unless `allByDefault` is false.
 */
export async function multiSelect(title: string, options: SelectOption[], config: { allByDefault?: boolean } = {}): Promise<string[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('multiSelect requires a TTY');
  if (options.length === 0) return [];

  const checked = options.map(() => config.allByDefault !== false);
  let cursor = 0;

  const stdin = process.stdin;
  readline.emitKeypressEvents(stdin);
  const priorRaw = stdin.isRaw ?? false;
  stdin.setRawMode(true);
  stdin.resume();
  process.stdout.write('\x1b[?25l');

  const cleanup = () => {
    process.stdout.write('\x1b[?25h\n');
    stdin.setRawMode(priorRaw);
    if (!priorRaw) stdin.pause();
  };

  const render = () => {
    const lines = [
      `${BOLD}${title}${RESET}`,
      ...options.map((option, index) => {
        const marker = checked[index] ? '[x]' : '[ ]';
        const pointer = index === cursor ? `${CYAN}❯${RESET} ` : '  ';
        const detail = option.detail ? `  ${DIM}${option.detail}${RESET}` : '';
        return `${pointer}${marker} ${option.label}${detail}`;
      }),
      `${DIM}↑/↓ move · space toggle · a all · enter confirm · ctrl-c abort${RESET}`,
    ];
    const total = lines.length + 1; // +1: the newline the previous render ended on
    process.stdout.write(`\x1b[${total}A\x1b[0J`);
    process.stdout.write(lines.join('\n') + '\n');
  };

  return new Promise<string[]>((resolve) => {
    const finish = (selection: string[]) => {
      stdin.removeListener('keypress', onKey);
      cleanup();
      resolve(selection);
    };
    const onKey = (_chunk: string, key: readline.Key) => {
      if (key.ctrl && key.name === 'c') {
        finish([]);
        process.exitCode = 130;
        return;
      }
      if (key.name === 'up' || key.name === 'k') cursor = (cursor - 1 + options.length) % options.length;
      else if (key.name === 'down' || key.name === 'j') cursor = (cursor + 1) % options.length;
      else if (key.name === 'space') checked[cursor] = !checked[cursor];
      else if (key.name === 'a') {
        const all = checked.every(Boolean);
        for (let i = 0; i < checked.length; i += 1) checked[i] = !all;
      } else if (key.name === 'return') {
        finish(options.filter((_, index) => checked[index]).map((option) => option.id));
        return;
      } else return;
      render();
    };
    stdin.on('keypress', onKey);
    render();
  });
}
