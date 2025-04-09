# Spotify Playlist Curator MCP Server

An MCP server that helps curate Spotify playlists by analyzing your existing tracks and using Claude AI to recommend songs based on mood, vibe, BPM, and other musical attributes.

## Features

- Connect to your Spotify account and access your playlists
- Analyze the audio features of tracks in your playlists
- Generate a summary of playlist mood, energy, tempo, and other characteristics
- Get song recommendations from Claude AI based on the playlist analysis
- Search for tracks on Spotify
- Add recommended tracks to your playlists
- Create new playlists

## Setup

### Prerequisites

- Node.js (v14 or higher)
- A Spotify Developer account and registered application
- Claude access via MCP (Machine Conversation Protocol)

### Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/spotify-playlist-curator-mcp.git
   cd spotify-playlist-curator-mcp
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on the provided `.env.example`:
   ```
   cp .env.example .env
   ```

4. Set up your Spotify Developer credentials:
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
   - Create a new application
   - Add `http://localhost:3000/callback` as a Redirect URI
   - Copy your Client ID and Client Secret to the `.env` file

5. Start the server:
   ```
   npm start
   ```

## Usage

### Authentication

When you start the server, you'll need to authenticate with Spotify first:

1. Visit `http://localhost:3000/login` in your browser
2. Log in with your Spotify account and authorize the application
3. After successful authentication, you can close the browser window and return to your MCP client

### MCP Methods

The following MCP methods are available:

#### `getPlaylists`

Returns a list of your Spotify playlists.

```javascript
const response = await client.getPlaylists();
```

#### `getPlaylistDetails`

Gets detailed information about a specific playlist, including track analysis.

```javascript
const response = await client.getPlaylistDetails({
  playlistId: "your_playlist_id"
});
```

#### `getClaudeRecommendations`

Gets song recommendations from Claude AI based on playlist analysis.

```javascript
const response = await client.getClaudeRecommendations({
  playlistId: "your_playlist_id",
  count: 10 // Optional, defaults to 10
});
```

#### `addRecommendationsToPlaylist`

Adds recommended tracks to a playlist.

```javascript
const response = await client.addRecommendationsToPlaylist({
  playlistId: "your_playlist_id",
  trackUris: ["spotify:track:id1", "spotify:track:id2", ...]
});
```

#### `searchTracks`

Searches for tracks on Spotify.

```javascript
const response = await client.searchTracks({
  query: "search query",
  limit: 10 // Optional, defaults to 10
});
```

#### `createPlaylist`

Creates a new Spotify playlist.

```javascript
const response = await client.createPlaylist({
  name: "My New Playlist",
  description: "Created by Spotify Playlist Curator", // Optional
  isPublic: false // Optional, defaults to false
});
```

## Example Client Usage

```javascript
import { createClient } from '@anthropic-ai/mcp-client';

async function main() {
  // Create MCP client
  const client = createClient({
    serverUrl: 'http://localhost:3000',
    anthropicApiKey: 'your_anthropic_api_key' // Required for Claude integration
  });

  // 1. Get user playlists
  const playlists = await client.getPlaylists();
  console.log('Your playlists:', playlists);

  // 2. Select a playlist and get its details
  const playlistId = playlists.playlists[0].id;
  const playlistDetails = await client.getPlaylistDetails({ playlistId });
  console.log('Playlist summary:', playlistDetails.summary);

  // 3. Get recommendations from Claude
  const recommendations = await client.getClaudeRecommendations({ playlistId });
  console.log('Claude recommendations:', recommendations.claudeRecommendations);

  // 4. Add recommendations to the playlist
  const trackUris = recommendations.claudeRecommendations
    .filter(track => track.matched)
    .map(track => track.uri);
  
  if (trackUris.length > 0) {
    const result = await client.addRecommendationsToPlaylist({ playlistId, trackUris });
    console.log('Added recommendations:', result);
  }
}

main().catch(console.error);
```

## License

MIT
