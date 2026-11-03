// pm2 start ecosystem.config.cjs      (then: pm2 save && pm2 startup  to survive reboots)
module.exports = {
  apps: [
    {
      name: 'paper-lab',
      script: 'src/cli.ts',
      interpreter: 'node',
      node_args: '--no-warnings',
      args: 'run --out ./out',
      autorestart: true,
      stop_exit_codes: [0],      // exit 0 == the 48h run finished: do not restart
      restart_delay: 5000,
      max_restarts: 50,
      env: { PAPER_PROVIDER: 'binance' },
    },
    {
      name: 'paper-lab-dashboard',
      script: 'src/cli.ts',
      interpreter: 'node',
      node_args: '--no-warnings',
      args: 'serve --out ./out --port 8080',
      autorestart: true,
    },
  ],
};
