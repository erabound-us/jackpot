module.exports = {
  apps: [{
    name:        'jackpot',
    script:      'server.js',
    cwd:         'C:\\Jackpot',
    watch:       false,
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
      PORT:     '7000'
    },
    log_file:    'C:\\Jackpot\\logs\\combined.log',
    out_file:    'C:\\Jackpot\\logs\\out.log',
    error_file:  'C:\\Jackpot\\logs\\error.log',
    time:        true
  }]
};
