FROM denoland/deno:1.37.0

WORKDIR /app

# Cache the dependencies as a layer
COPY deps.ts .
RUN deno cache deps.ts

# Copy the source code
COPY . .

# Cache the source code
RUN deno cache src/main.ts src/consumer.ts

# Create a script to run both processes
RUN echo '#!/bin/sh\n\
deno run --allow-net --allow-env --allow-sys --allow-read --allow-write src/consumer.ts & \
deno run --allow-net --allow-env --allow-sys --allow-read --allow-write src/main.ts\n\
wait' > /app/start.sh && chmod +x /app/start.sh

CMD ["/app/start.sh"] 