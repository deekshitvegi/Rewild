import base from '/tmp/rewild/snap/vite.config.ts';
export default async (env) => {
  const cfg = typeof base === 'function' ? await base(env) : base;
  return {
    ...cfg, root: '/tmp/rewild/snap', cacheDir: '/tmp/rewild/vitecache-snap',
    server: { ...(cfg.server ?? {}), fs: { ...(cfg.server?.fs ?? {}), allow: ['/tmp/rewild/snap', '/home/user/deekshitthvegiportfolio/node_modules'] } },
  };
};
