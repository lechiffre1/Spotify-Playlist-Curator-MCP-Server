// spotify-playlist-curator-mcp/index.js
import { createServer } from '@anthropic-ai/mcp';
import express from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import path from 'path';

dotenv.config();

// Initialize Spotify API with client credentials
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback'
});

// Create an Express app for handling the Spotify OAuth flow
const app = express();
const PORT = process.env.PORT || 3000;

// Store for user tokens
const userTokens = {};

// Authentication status
let isAuthenticated = false;

// Authentication route
app.get('/login', (req, res) => {
  const scopes = [
    'user-read-private',
    'user-read-email',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-modify-private'
  ];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, 'spotify-auth-state');
  res.redirect(authorizeURL);
});

// Callback route after Spotify authentication
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;
    
    // Set the access token and refresh token
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    
    // Save tokens for future use
    userTokens.accessToken = access_token;
    userTokens.refreshToken = refresh_token;
    userTokens.expiresAt = Date.now() + data.body.expires_in * 1000;
    
    isAuthenticated = true;
    
    // Save tokens to a file for persistence
    writeFileSync(
      path.join(process.cwd(), '.spotify_tokens.json'),
      JSON.stringify(userTokens)
    );
    
    res.send('Authentication successful! You can close this window and return to your MCP client.');
  } catch (error) {
    console.error('Error during authentication:', error);
    res.status(500).send(`Authentication error: ${error.message}`);
  }
});

// Function to refresh the access token if needed
async function ensureValidToken() {
  // Try to load tokens from file if they're not in memory
  if (!userTokens.accessToken && !userTokens.refreshToken) {
    try {
      const tokenFile = path.join(process.cwd(), '.spotify_tokens.json');
      const fileContent = readFileSync(tokenFile, 'utf8');
      const savedTokens = JSON.parse(fileContent);
      
      userTokens.accessToken = savedTokens.accessToken;
      userTokens.refreshToken = savedTokens.refreshToken;
      userTokens.expiresAt = savedTokens.expiresAt;
      
      spotifyApi.setAccessToken(userTokens.accessToken);
      spotifyApi.setRefreshToken(userTokens.refreshToken);
      isAuthenticated = true;
    } catch (error) {
      console.log('No stored tokens found or error loading them.');
      return false;
    }
  }
  
  // Check if token is expired or about to expire (within 5 minutes)
  const isTokenExpired = userTokens.expiresAt && Date.now() > userTokens.expiresAt - 300000;
  
  if (isTokenExpired && userTokens.refreshToken) {
    try {
      const data = await spotifyApi.refreshAccessToken();
      userTokens.accessToken = data.body.access_token;
      spotifyApi.setAccessToken(userTokens.accessToken);
      userTokens.expiresAt = Date.now() + data.body.expires_in * 1000;
      
      // Update the saved tokens
      writeFileSync(
        path.join(process.cwd(), '.spotify_tokens.json'),
        JSON.stringify(userTokens)
      );
      
      return true;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return false;
    }
  }
  
  return isAuthenticated;
}

// Start the Express server
app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
  console.log(`Please authenticate with Spotify at http://localhost:${PORT}/login`);
});

// Function to analyze tracks and extract relevant features
async function analyzePlaylistTracks(tracks) {
  const trackIds = tracks.map(track => track.track.id);
  
  // Get audio features for all tracks
  const audioFeatures = await spotifyApi.getAudioFeaturesForTracks(trackIds);
  
  // Combine track info with audio features
  const analyzedTracks = tracks.map((track, index) => {
    const features = audioFeatures.body.audio_features[index];
    return {
      id: track.track.id,
      name: track.track.name,
      artists: track.track.artists.map(artist => artist.name),
      album: track.track.album.name,
      popularity: track.track.popularity,
      // Audio features
      danceability: features?.danceability,
      energy: features?.energy,
      key: features?.key,
      loudness: features?.loudness,
      mode: features?.mode,
      speechiness: features?.speechiness,
      acousticness: features?.acousticness,
      instrumentalness: features?.instrumentalness,
      liveness: features?.liveness,
      valence: features?.valence,
      tempo: features?.tempo,
      duration_ms: features?.duration_ms,
      time_signature: features?.time_signature
    };
  });
  
  return analyzedTracks;
}

// Function to get track recommendations from Spotify based on seed tracks
async function getSpotifyRecommendations(seedTrackIds, count = 10) {
  // Get recommendations from Spotify
  const recommendations = await spotifyApi.getRecommendations({
    seed_tracks: seedTrackIds.slice(0, 5), // Spotify allows max 5 seed tracks
    limit: count
  });
  
  return recommendations.body.tracks.map(track => ({
    id: track.id,
    name: track.name,
    artists: track.artists.map(artist => artist.name),
    album: track.album.name,
    uri: track.uri
  }));
}

// Function to summarize playlist mood and style
function summarizePlaylist(analyzedTracks) {
  // Calculate averages for numerical features
  const features = [
    'danceability', 'energy', 'loudness', 'speechiness',
    'acousticness', 'instrumentalness', 'liveness', 'valence', 'tempo'
  ];
  
  const averages = {};
  features.forEach(feature => {
    const values = analyzedTracks
      .map(track => track[feature])
      .filter(value => value !== undefined);
    
    const sum = values.reduce((acc, val) => acc + val, 0);
    averages[feature] = sum / values.length;
  });
  
  // Determine mood based on valence and energy
  let mood;
  if (averages.valence > 0.7) {
    mood = averages.energy > 0.7 ? 'Euphoric/Excited' : 'Happy/Cheerful';
  } else if (averages.valence > 0.4) {
    mood = averages.energy > 0.7 ? 'Energetic/Tense' : 'Balanced/Neutral';
  } else {
    mood = averages.energy > 0.7 ? 'Angry/Intense' : 'Sad/Melancholic';
  }
  
  // Determine genre hints based on artists
  const allArtists = analyzedTracks.flatMap(track => track.artists);
  
  return {
    mood,
    averages,
    trackCount: analyzedTracks.length,
    popularityAvg: analyzedTracks.reduce((acc, track) => acc + track.popularity, 0) / analyzedTracks.length,
    summary: `This playlist has ${analyzedTracks.length} tracks with an average tempo of ${Math.round(averages.tempo)} BPM. 
      The overall mood seems ${mood.toLowerCase()}, with 
      ${averages.energy > 0.7 ? 'high' : averages.energy > 0.4 ? 'moderate' : 'low'} energy and 
      ${averages.danceability > 0.7 ? 'high' : averages.danceability > 0.4 ? 'moderate' : 'low'} danceability.
      ${averages.acousticness > 0.6 ? 'The playlist features mostly acoustic sounds.' : ''}
      ${averages.instrumentalness > 0.5 ? 'The playlist is primarily instrumental.' : ''}
      ${averages.speechiness > 0.33 ? 'The playlist contains significant spoken word elements.' : ''}`
  };
}

// Function to add tracks to a playlist
async function addTracksToPlaylist(playlistId, trackUris) {
  return await spotifyApi.addTracksToPlaylist(playlistId, trackUris);
}

// Create the MCP server
const server = createServer({
  // Server information
  title: 'Spotify Playlist Curator',
  description: 'MCP server that curates Spotify playlists using Claude AI',
  version: '1.0.0',
  
  // Server initialization
  async init({ logger }) {
    logger.info('Starting Spotify Playlist Curator MCP server');
    
    // Check for existing authentication
    const isValid = await ensureValidToken();
    if (isValid) {
      logger.info('Successfully loaded existing Spotify authentication');
    } else {
      logger.info(`Please authenticate with Spotify at http://localhost:${PORT}/login`);
    }
    
    return {
      // Return state object
      spotifyApi,
      isAuthenticated: isValid
    };
  },
  
  // Define methods
  methods: {
    // Get the user's playlists
    async getPlaylists({ state, logger }) {
      const isValid = await ensureValidToken();
      if (!isValid) {
        return {
          error: 'Not authenticated with Spotify',
          authUrl: `http://localhost:${PORT}/login`
        };
      }
      
      try {
        const data = await state.spotifyApi.getUserPlaylists();
        logger.info(`Retrieved ${data.body.items.length} playlists`);
        
        return {
          playlists: data.body.items.map(playlist => ({
            id: playlist.id,
            name: playlist.name,
            trackCount: playlist.tracks.total,
            image: playlist.images.length > 0 ? playlist.images[0].url : null,
            owner: playlist.owner.display_name,
            public: playlist.public
          }))
        };
      } catch (error) {
        logger.error('Error getting playlists:', error);
        return { error: error.message };
      }
    },
    
    // Get a specific playlist with its tracks
    async getPlaylistDetails({ args, state, logger }) {
      const { playlistId } = args;
      
      if (!playlistId) {
        return { error: 'Playlist ID is required' };
      }
      
      const isValid = await ensureValidToken();
      if (!isValid) {
        return {
          error: 'Not authenticated with Spotify',
          authUrl: `http://localhost:${PORT}/login`
        };
      }
      
      try {
        // Get the playlist
        const playlist = await state.spotifyApi.getPlaylist(playlistId);
        
        // Get all tracks (handling pagination)
        let allTracks = [];
        let offset = 0;
        const limit = 100;
        
        while (true) {
          const tracks = await state.spotifyApi.getPlaylistTracks(playlistId, {
            offset,
            limit
          });
          
          allTracks = [...allTracks, ...tracks.body.items];
          
          if (tracks.body.items.length < limit) {
            break;
          }
          
          offset += limit;
        }
        
        logger.info(`Retrieved ${allTracks.length} tracks from playlist ${playlist.body.name}`);
        
        // Analyze tracks to get audio features
        const analyzedTracks = await analyzePlaylistTracks(allTracks);
        
        // Create a summary of the playlist
        const summary = summarizePlaylist(analyzedTracks);
        
        return {
          id: playlist.body.id,
          name: playlist.body.name,
          description: playlist.body.description,
          owner: playlist.body.owner.display_name,
          public: playlist.body.public,
          trackCount: playlist.body.tracks.total,
          image: playlist.body.images.length > 0 ? playlist.body.images[0].url : null,
          tracks: analyzedTracks,
          summary
        };
      } catch (error) {
        logger.error('Error getting playlist details:', error);
        return { error: error.message };
      }
    },
    
    // Get recommendations from Claude based on playlist analysis
    async getClaudeRecommendations({ args, state, claude, logger }) {
      const { playlistId, count = 10 } = args;
      
      if (!playlistId) {
        return { error: 'Playlist ID is required' };
      }
      
      const isValid = await ensureValidToken();
      if (!isValid) {
        return {
          error: 'Not authenticated with Spotify',
          authUrl: `http://localhost:${PORT}/login`
        };
      }
      
      try {
        // Get playlist details including track analysis
        const playlistDetails = await server.methods.getPlaylistDetails.call(this, {
          args: { playlistId },
          state,
          logger
        });
        
        if (playlistDetails.error) {
          return playlistDetails;
        }
        
        // Create a prompt for Claude with the playlist analysis
        const message = `I want you to recommend ${count} songs that would fit well with this Spotify playlist. 
Here's the analysis of the existing playlist:

Playlist name: ${playlistDetails.name}
Description: ${playlistDetails.description || 'No description'}
Number of tracks: ${playlistDetails.trackCount}

Playlist mood: ${playlistDetails.summary.mood}
Average tempo: ${Math.round(playlistDetails.summary.averages.tempo)} BPM
Average energy: ${playlistDetails.summary.averages.energy.toFixed(2)} (0-1 scale)
Average danceability: ${playlistDetails.summary.averages.danceability.toFixed(2)} (0-1 scale)
Average valence (positivity): ${playlistDetails.summary.averages.valence.toFixed(2)} (0-1 scale)
Average acousticness: ${playlistDetails.summary.averages.acousticness.toFixed(2)} (0-1 scale)

Some example tracks in the playlist:
${playlistDetails.tracks.slice(0, 5).map(track => 
  `- "${track.name}" by ${track.artists.join(', ')}`
).join('\n')}

Based on this information, please recommend ${count} songs (with artists) that would fit well with this playlist's mood, style, and energy level. Just provide the song titles and artists, nothing else. Format each recommendation as "Song Title - Artist Name" on a separate line.`;

        // Get recommendations from Claude
        const claudeResponse = await claude.sendMessage(message);
        const recommendationText = claudeResponse.content[0].text;
        
        // Parse recommendations
        const recommendations = recommendationText
          .split('\n')
          .filter(line => line.trim() !== '' && line.includes('-'))
          .map(line => {
            const [name, artist] = line.split('-').map(part => part.trim());
            return { name, artist };
          });
        
        logger.info(`Claude recommended ${recommendations.length} songs`);
        
        // Search for each recommendation on Spotify
        const spotifyRecommendations = [];
        
        for (const rec of recommendations) {
          try {
            const searchQuery = `track:${rec.name} artist:${rec.artist}`;
            const searchResult = await state.spotifyApi.searchTracks(searchQuery, { limit: 1 });
            
            if (searchResult.body.tracks.items.length > 0) {
              const track = searchResult.body.tracks.items[0];
              spotifyRecommendations.push({
                id: track.id,
                name: track.name,
                artists: track.artists.map(artist => artist.name),
                album: track.album.name,
                uri: track.uri,
                matched: true
              });
            } else {
              // If no exact match, add the recommendation anyway
              spotifyRecommendations.push({
                ...rec,
                matched: false
              });
            }
          } catch (error) {
            logger.error(`Error searching for track "${rec.name}":`, error);
          }
        }
        
        // As a fallback, also get some recommendations directly from Spotify API
        const seedTracks = playlistDetails.tracks
          .sort(() => 0.5 - Math.random()) // Randomize
          .slice(0, 5)
          .map(track => track.id);
        
        let spotifyApiRecommendations = [];
        
        try {
          spotifyApiRecommendations = await getSpotifyRecommendations(seedTracks, 5);
        } catch (error) {
          logger.error('Error getting Spotify API recommendations:', error);
        }
        
        return {
          playlistName: playlistDetails.name,
          playlistId: playlistDetails.id,
          claudeRecommendations: spotifyRecommendations,
          spotifyRecommendations: spotifyApiRecommendations,
          originalPrompt: message,
          claudeResponse: recommendationText
        };
      } catch (error) {
        logger.error('Error getting Claude recommendations:', error);
        return { error: error.message };
      }
    },
    
    // Add recommended tracks to the playlist
    async addRecommendationsToPlaylist({ args, state, logger }) {
      const { playlistId, trackUris } = args;
      
      if (!playlistId || !trackUris || !Array.isArray(trackUris)) {
        return { error: 'Playlist ID and an array of track URIs are required' };
      }
      
      const isValid = await ensureValidToken();
      if (!isValid) {
        return {
          error: 'Not authenticated with Spotify',
          authUrl: `http://localhost:${PORT}/login`
        };
      }
      
      try {
        await addTracksToPlaylist(playlistId, trackUris);
        logger.info(`Added ${trackUris.length} tracks to playlist ${playlistId}`);
        
        return {
          success: true,
          message: `Successfully added ${trackUris.length} tracks to the playlist`
        };
      } catch (error) {
        logger.error('Error adding tracks to playlist:', error);
        return { error: error.message };
      }
    },
    
    // Search for tracks on Spotify
    async searchTracks({ args, state, logger }) {
      const { query, limit = 10 } = args;
      
      if (!query) {
        return { error: 'Search query is required' };
      }
      
      const isValid = await ensureValidToken();
      if (!isValid) {
        return {
          error: 'Not authenticated with Spotify',
          authUrl: `http://localhost:${PORT}/login`
        };
      }
      
      try {
        const results = await state.spotifyApi.searchTracks(query, { limit });
        
        logger.info(`Found ${results.body.tracks.items.length} tracks for query "${query}"`);
        
        return {
          tracks: results.body.tracks.items.map(track => ({
            id: track.id,
            name: track.name,
            artists: track.artists.map(artist => artist.name),
            album: track.album.name,
            uri: track.uri
          }))
        };
      } catch (error) {
        logger.error('Error searching for tracks:', error);
        return { error: error.message };
      }
    },
    
    // Create a new playlist
    async createPlaylist({ args, state, logger }) {
      const { name, description = '', isPublic = false } = args;
      
      if (!name) {
        return { error: 'Playlist name is required' };
      }
      
      const isValid = await ensureValidToken();
      if (!isValid) {
        return {
          error: 'Not authenticated with Spotify',
          authUrl: `http://localhost:${PORT}/login`
        };
      }
      
      try {
        // Get user profile to get user ID
        const user = await state.spotifyApi.getMe();
        const userId = user.body.id;
        
        // Create the playlist
        const playlist = await state.spotifyApi.createPlaylist(userId, {
          name,
          description,
          public: isPublic
        });
        
        logger.info(`Created new playlist "${name}" with ID ${playlist.body.id}`);
        
        return {
          id: playlist.body.id,
          name: playlist.body.name,
          description: playlist.body.description,
          owner: playlist.body.owner.display_name,
          public: playlist.body.public,
          url: playlist.body.external_urls.spotify
        };
      } catch (error) {
        logger.error('Error creating playlist:', error);
        return { error: error.message };
      }
    }
  }
});

// Start the server
server.listen(() => {
  console.log('Spotify Playlist Curator MCP server is running');
});
