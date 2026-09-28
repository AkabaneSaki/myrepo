const TYPES = ['角色', '扩展', '系统核心', '事件'];

export function createFixtureProjects(count = 110) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const projectType = TYPES[index % TYPES.length];
    const extensionType = projectType === '扩展' ? (index % 2 === 0 ? '规则' : '内容') : null;
    const tags = [
      projectType === '扩展' ? extensionType : projectType,
      number % 3 === 0 ? '人类' : '冒险者',
      number % 5 === 0 ? '帝国' : '王国',
    ].filter(Boolean);

    return {
      id: `fixture-project-${String(number).padStart(3, '0')}`,
      name: `Fixture Project ${String(number).padStart(3, '0')}`,
      description: `Deterministic Playwright fixture ${number}`,
      authorId: 'fixture-author',
      authorName: 'Fixture Author',
      username: 'fixture-author',
      projectType,
      extensionType,
      tags,
      displayTags: tags.slice(0, 3),
      version: `1.0.${number}`,
      versionLabel: `1.0.${number}`,
      status: 'approved',
      isPublished: true,
      visibility: true,
      likesCount: number,
      downloadsCount: number * 2,
      publishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, number % 60)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 0, 2, 0, 0, number % 60)).toISOString(),
    };
  });
}

function filterProjects(projects, url) {
  let result = [...projects];
  const projectType = url.searchParams.get('projectType');
  const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
  const tags = String(url.searchParams.get('tags') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const sort = String(url.searchParams.get('sort') || 'published');

  if (projectType && projectType !== 'all') {
    result = result.filter(project => project.projectType === projectType);
  }
  if (search) {
    result = result.filter(project =>
      [project.id, project.name, project.authorName, ...(project.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  }
  if (tags.length) {
    result = result.filter(project => tags.every(tag => (project.tags || []).includes(tag)));
  }

  if (sort === 'discover') {
    // Keep fixture insertion order so stable fixture IDs are also stable Discover identities.
  } else if (sort === 'likes') result.sort((a, b) => b.likesCount - a.likesCount);
  else if (sort === 'downloads') result.sort((a, b) => b.downloadsCount - a.downloadsCount);
  else if (sort === 'updated') result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  else result.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

  return result;
}

function publicCounts(projects) {
  const byType = Object.fromEntries(TYPES.map(type => [type, 0]));
  for (const project of projects) byType[project.projectType] = (byType[project.projectType] || 0) + 1;
  return { total: projects.length, byType };
}

export async function installProjectCatalogFixture(page, { projects = createFixtureProjects() } = {}) {
  const byId = new Map(projects.map(project => [String(project.id), project]));

  await page.route(/\/api\/projects\/[^/?]+(?:\?.*)?$/, async route => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();

    const url = new URL(request.url());
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 3 || segments[0] !== 'api' || segments[1] !== 'projects') {
      return route.continue();
    }

    const projectId = decodeURIComponent(segments[2]);
    const project = byId.get(projectId);
    if (!project) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fixture project not found' }),
      });
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project,
        worldbookEntriesPreview: [],
        regexEntriesPreview: [],
      }),
    });
  });

  await page.route('**/api/projects?**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();

    const url = new URL(request.url());
    const filtered = filterProjects(projects, url);
    const pageIndex = Math.max(0, Number(url.searchParams.get('page') || 0));
    const pageSize = Math.max(1, Number(url.searchParams.get('pageSize') || 48));
    const start = pageIndex * pageSize;
    const pageProjects = filtered.slice(start, start + pageSize);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projects: pageProjects,
        page: pageIndex,
        pageSize,
        hasMore: start + pageSize < filtered.length,
        publicCounts: publicCounts(projects),
      }),
    });
  });

  return projects;
}

export async function installDailyRandomFixture(
  page,
  { projectId = 'fixture-project-001', limit = 10, initialCount = 0 } = {},
) {
  let count = Math.max(0, Number(initialCount || 0));
  const normalizedLimit = Math.max(1, Number(limit || 10));
  const payload = () => ({
    count,
    limit: normalizedLimit,
    remaining: Math.max(0, normalizedLimit - count),
    drawDay: 'fixture-day',
    resetAt: '2099-01-01T05:00:00+08:00',
  });

  await page.route('**/api/projects/random-draw/state', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload()),
    });
  });

  await page.route('**/api/projects/random-draw', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    count = Math.min(normalizedLimit, count + 1);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...payload(),
        projectId,
      }),
    });
  });
}
