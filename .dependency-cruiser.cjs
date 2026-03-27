/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'components-must-not-depend-on-app',
      severity: 'error',
      from: { path: '^components/' },
      to: { path: '^app/' },
    },
    {
      name: 'lib-must-not-depend-on-components',
      severity: 'error',
      from: { path: '^lib/' },
      to: { path: '^components/' },
    },
    {
      name: 'lib-must-not-depend-on-app',
      severity: 'error',
      from: { path: '^lib/' },
      to: { path: '^app/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
      },
    },
  },
};
