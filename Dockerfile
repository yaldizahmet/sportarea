FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy server package files
COPY server/package*.json ./server/

# Install server dependencies
RUN cd server && npm install

# Copy server source code and database
COPY server/ ./server/

# Compile TypeScript to JavaScript
RUN cd server && npm run build

# Expose the port the app runs on
EXPOSE 3000

# Start the Node server
CMD ["npm", "start", "--prefix", "server"]
