module.exports = {
  apps: [{
    name: 'project-tasks-mcp',
    cwd: __dirname,
    script: process.execPath,
    args: ['--env-file-if-exists=.env', '--import', 'tsx', 'src/main.ts'],
    interpreter: 'none',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    kill_timeout: 30000,
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
