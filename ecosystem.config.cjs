module.exports = {
  apps: [{
    name: "rehabintl-inquiry-crm",
    script: "node_modules/next/dist/bin/next",
    args: "start -H 127.0.0.1 -p 3011",
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      PORT: "3011",
      DATA_DIR: "./data"
    }
  }]
};
