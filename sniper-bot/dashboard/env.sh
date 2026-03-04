#!/bin/sh
# This script runs before Nginx starts.
# It uses envsubst to replace placeholders like ${API_URL} inside our static HTML/JS 
# with the actual environment variables provided at runtime by the VPS/Docker-Compose.

# Ensure the default variable exists if not passed inside docker
export API_URL=${API_URL:-"/api"}

# Replace runtime environment variables in the built JavaScript files
for i in /usr/share/nginx/html/assets/*.js;
do
  if [ -f "$i" ]; then
    # Replace API_URL_PLACEHOLDER with the actual API url
    sed -i "s|API_URL_PLACEHOLDER|${API_URL}|g" "$i"
  fi
done

# Execute the CMD passed by Dockerfile (starting nginx)
exec "$@"
