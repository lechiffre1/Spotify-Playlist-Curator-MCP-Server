// client-example.js
import { createClient } from '@anthropic-ai/mcp-client';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

// Create readline interface for CLI interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to prompt for input
const prompt = (question) => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
};

// MCP client setup
const client = createClient({
  serverUrl: process.env.MCP_SERVER_URL || 'http://localhost:3000',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY
});

async function displayPlaylists(playlists) {
  console.log('\nYour Spotify Playlists:');
  console.log('------------------------');
  playlists.forEach((playlist, index) => {
    console.log(`${index + 1}. ${playlist.name} (${playlist.trackCount} tracks)`);
  });
}

async function displayRecommendations(recommendations) {
  console.log('\nClaude\'s Recommendations:');
  console.log('-------------------------');
  recommendations.claudeRecommendations.forEach((track, index) => {
    if (track.matched) {
      console.log(`${index + 1}. ${track.name} by ${track.artists.join(', ')} [${track.uri}]`);
    } else {
      console.log(`${index + 1}. ${track.name} by ${track.artist} [Not found on Spotify]`);
    }
  });
  
  console.log('\nSpotify\'s Recommendations:');
  console.log('-------------------------');
  recommendations.spotifyRecommendations.forEach((track, index) => {
    console.log(`${index + 1}. ${track.name} by ${track.artists.join(', ')} [${track.uri}]`);
  });
}

async function main() {
  try {
    console.log('Welcome to Spotify Playlist Curator!');
    console.log('-----------------------------------');
    
    // Step 1: Get user playlists
    console.log('\nFetching your Spotify playlists...');
    const playlistsResponse = await client.getPlaylists();
    
    if (playlistsResponse.error) {
      if (playlistsResponse.authUrl) {
        console.log(`Please authenticate with Spotify first by visiting: ${playlistsResponse.authUrl}`);
        console.log('After authentication, restart this client.');
        rl.close();
        return;
      }
      throw new Error(playlistsResponse.error);
    }
    
    // Display playlists
    await displayPlaylists(playlistsResponse.playlists);
    
    // Step 2: Select a playlist for curation
    const playlistIndex = parseInt(await prompt('\nEnter the number of the playlist you want to curate: ')) - 1;
    if (isNaN(playlistIndex) || playlistIndex < 0 || playlistIndex >= playlistsResponse.playlists.length) {
      throw new Error('Invalid playlist selection.');
    }
    
    const selectedPlaylist = playlistsResponse.playlists[playlistIndex];
    console.log(`\nSelected: ${selectedPlaylist.name}`);
    
    // Step 3: Get playlist details and analyze
    console.log('\nAnalyzing playlist tracks...');
    const playlistDetails = await client.getPlaylistDetails({
      playlistId: selectedPlaylist.id
    });
    
    if (playlistDetails.error) {
      throw new Error(playlistDetails.error);
    }
    
    // Display playlist summary
    console.log('\nPlaylist Analysis:');
    console.log('-----------------');
    console.log(playlistDetails.summary.summary);
    console.log(`Mood: ${playlistDetails.summary.mood}`);
    console.log(`Average BPM: ${Math.round(playlistDetails.summary.averages.tempo)}`);
    console.log(`Energy: ${playlistDetails.summary.averages.energy.toFixed(2)}/1.0`);
    console.log(`Danceability: ${playlistDetails.summary.averages.danceability.toFixed(2)}/1.0`);
    console.log(`Positivity: ${playlistDetails.summary.averages.valence.toFixed(2)}/1.0`);
    
    // Step 4: Get recommendations from Claude
    const recommendCount = parseInt(await prompt('\nHow many recommendations would you like? (1-20): '));
    if (isNaN(recommendCount) || recommendCount < 1 || recommendCount > 20) {
      throw new Error('Please provide a number between 1 and 20.');
    }
    
    console.log('\nGetting recommendations from Claude...');
    const recommendations = await client.getClaudeRecommendations({
      playlistId: selectedPlaylist.id,
      count: recommendCount
    });
    
    if (recommendations.error) {
      throw new Error(recommendations.error);
    }
    
    // Display recommendations
    await displayRecommendations(recommendations);
    
    // Step 5: Ask if user wants to add recommendations to playlist
    const addToPlaylist = await prompt('\nWould you like to add some of these recommendations to your playlist? (y/n): ');
    if (addToPlaylist.toLowerCase() === 'y') {
      // Let user select which recommendations to add
      const selectionInput = await prompt('\nEnter the numbers of the Claude recommendations to add (comma-separated, e.g., 1,3,5): ');
      const selections = selectionInput.split(',').map(num => parseInt(num.trim()) - 1);
      
      const validSelections = selections.filter(index => 
        !isNaN(index) && 
        index >= 0 && 
        index < recommendations.claudeRecommendations.length &&
        recommendations.claudeRecommendations[index].matched
      );
      
      if (validSelections.length === 0) {
        console.log('No valid selections were made.');
      } else {
        const trackUris = validSelections.map(index => recommendations.claudeRecommendations[index].uri);
        
        console.log(`\nAdding ${trackUris.length} tracks to your playlist...`);
        const result = await client.addRecommendationsToPlaylist({
          playlistId: selectedPlaylist.id,
          trackUris
        });
        
        if (result.error) {
          throw new Error(result.error);
        }
        
        console.log(result.message);
      }
    }
    
    // Step 6: Ask if user wants to create a new playlist from recommendations
    const createNewPlaylist = await prompt('\nWould you like to create a new playlist with these recommendations? (y/n): ');
    if (createNewPlaylist.toLowerCase() === 'y') {
      const playlistName = await prompt('\nEnter a name for the new playlist: ');
      const playlistDescription = await prompt('Enter a description (optional): ');
      
      console.log('\nCreating new playlist...');
      const newPlaylist = await client.createPlaylist({
        name: playlistName,
        description: playlistDescription || `Based on ${selectedPlaylist.name}. Created by Spotify Playlist Curator.`
      });
      
      if (newPlaylist.error) {
        throw new Error(newPlaylist.error);
      }
      
      // Let user select which recommendations to add to the new playlist
      const selectionInput = await prompt('\nEnter the numbers of all recommendations to add (comma-separated, e.g., 1,3,5): ');
      const selections = selectionInput.split(',').map(num => parseInt(num.trim()) - 1);
      
      // Process Claude recommendations
      const claudeSelections = selections.filter(index => 
        !isNaN(index) && 
        index >= 0 && 
        index < recommendations.claudeRecommendations.length &&
        recommendations.claudeRecommendations[index].matched
      );
      
      // Process Spotify recommendations
      const spotifySelections = selections.filter(index => 
        !isNaN(index) && 
        index >= 0 && 
        index < recommendations.spotifyRecommendations.length
      ).map(index => index + recommendations.claudeRecommendations.length);
      
      // Combine track URIs
      const trackUris = [
        ...claudeSelections.map(index => recommendations.claudeRecommendations[index].uri),
        ...spotifySelections.map(index => recommendations.spotifyRecommendations[index - recommendations.claudeRecommendations.length].uri)
      ];
      
      if (trackUris.length === 0) {
        console.log('No valid selections were made.');
      } else {
        console.log(`\nAdding ${trackUris.length} tracks to your new playlist...`);
        const result = await client.addRecommendationsToPlaylist({
          playlistId: newPlaylist.id,
          trackUris
        });
        
        if (result.error) {
          throw new Error(result.error);
        }
        
        console.log(result.message);
        console.log(`\nYour new playlist "${playlistName}" is now available on Spotify!`);
        console.log(`Playlist URL: ${newPlaylist.url}`);
      }
    }
    
    console.log('\nThank you for using Spotify Playlist Curator!');
    rl.close();
  
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    rl.close();
  }
}

// Run the main function
main();
