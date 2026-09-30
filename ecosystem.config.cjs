module.exports = {
  apps: [{
    name: 'project-tasks-mcp',
    cwd: __dirname,
    script: process.execPath,
    args: ['--env-file-if-exists=.env', 'dist/src/prod.js'],
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
