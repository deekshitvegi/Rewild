import base from '/home/user/deekshitthvegiportfolio/vite.config.ts';
export default async (env) => {
  const cfg = typeof base === 'function' ? await base(env) : base;
  return { ...cfg, root: '/home/user/deekshitthvegiportfolio', cacheDir: '/tmp/rewild/vitecache-repo' };
};
