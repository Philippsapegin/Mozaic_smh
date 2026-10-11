import { execFileSync } from 'node:child_process';

export const repository = 'Philippsapegin/Mozaic_smh';

export function githubHeaders() {
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    const result = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const credentials = Object.fromEntries(result.trim().split(/\r?\n/).map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    token = credentials.password;
  }
  if (!token) throw new Error('GitHub authentication is unavailable.');
  return { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozaic-release', 'X-GitHub-Api-Version': '2022-11-28' };
}

export async function githubRequest(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...options, headers: { ...githubHeaders(), ...options.headers },
  });
  if (!response.ok) throw Object.assign(new Error(`GitHub returned ${response.status} for ${path}.`), { status: response.status });
  return response.status === 204 ? null : response.json();
}
