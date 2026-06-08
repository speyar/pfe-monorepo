module.exports = {
  apps: [
    {
      name: "falcon",
      script: "/var/www/falcon/node_modules/.bin/next",
      args: "start -p 3001",
      cwd: "/var/www/falcon/apps/web",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/var/log/falcon/error.log",
      out_file: "/var/log/falcon/out.log",
      merge_logs: true,
    },
  ],
}
