const checks = [
  ['projects API', 'http://127.0.0.1:8792/api/projects?page=0&pageSize=1&sort=published'],
  ['Local Explorer', 'http://127.0.0.1:8792/cdn-cgi/local/explorer'],
];

for (const [name, url] of checks) {
  const response = await fetch(url, { redirect: 'follow' });
  console.log(`${name}: HTTP ${response.status} ${response.url}`);
  if (!response.ok) {
    process.exitCode = 1;
  }
}
