import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios'; // Import axios
import './App.css';

// Use the environment variable defined in frontend/.env
// Fallback for safety, though proxy should handle base URL in dev
const API_BASE_URL = process.env.REACT_APP_BACKEND_API_BASE_URL || '';

// Create an axios instance with default config
const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`, // Set base URL for all requests
  withCredentials: true, // Crucial for sending session cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

function App() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [userData, setUserData] = useState(null);
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [playlistName, setPlaylistName] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isConverting, setIsConverting] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState(null);

    // --- API Interaction Logic (Refactored with Axios) ---
    const fetchAPI = useCallback(async (endpoint, options = {}) => {
        const config = {
            method: options.method || 'GET', // Default to GET if not specified
            url: endpoint, // Axios uses 'url' relative to baseURL
            data: options.body, // Axios uses 'data' for request body
            headers: {
                ...(options.headers || {}), // Merge any additional headers
            },
            // `withCredentials` and `baseURL` are handled by the apiClient instance
        };

        try {
            const response = await apiClient(config);

            // Axios automatically handles JSON parsing
            return response.data;

        } catch (err) {
            console.error('Axios API Error:', err);

            // Axios wraps errors, check for response data
            const errorData = err.response?.data;
            const status = err.response?.status;
            let errorMessage = 'An unexpected error occurred.';

            if (errorData) {
                 errorMessage = errorData.message || errorData.error || `Request failed with status ${status}`;
                // Handle specific auth error
                if (status === 401 || errorData.auth_required) {
                    setIsLoggedIn(false);
                    setUserData(null);
                    errorMessage = errorData.error || 'Authentication required. Please log in.';
                }
            } else if (err.request) {
                // The request was made but no response was received
                errorMessage = 'No response received from server. Check network or server status.';
            } else {
                // Something happened in setting up the request that triggered an Error
                errorMessage = err.message;
            }


            setError(errorMessage);
            setIsLoading(false); // Ensure loading stops on error
            setIsConverting(false);
            return null; // Indicate failure
        }
    }, []); // No dependencies needed as apiClient is stable

    // --- Authentication Handling ---
    const checkAuthStatus = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setResults(null);
        console.log("Checking auth status...");
        try {
            // Use the refactored fetchAPI
            const data = await fetchAPI('/auth/status');
            if (data && data.logged_in) {
                console.log("User logged in:", data.user);
                setIsLoggedIn(true);
                setUserData(data.user);
            } else {
                console.log("User not logged in.");
                setIsLoggedIn(false);
                setUserData(null);
                 // Check for errors passed in URL query params after failed callback
                const urlParams = new URLSearchParams(window.location.search);
                const errorParam = urlParams.get('error');
                if (errorParam) {
                    setError(`Login failed: ${errorParam.replace(/_/g, ' ')}. Please try again.`);
                    // Clean the URL
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
                 // If data exists but logged_in is false, and no URL error, don't set generic error
                 if (data && !data.logged_in && !errorParam) {
                     // No specific error needed here, it's just the normal "not logged in" state
                 } else if (!data && !errorParam) {
                     // If fetchAPI returned null (error handled internally), don't overwrite potentially specific error
                 }
            }
        } catch (err) {
             // Error should be set within fetchAPI now
             console.error("Error caught in checkAuthStatus:", err); // Keep for debugging if fetchAPI somehow throws unexpectedly
             setIsLoggedIn(false);
             setUserData(null);
             // Ensure loading stops even if fetchAPI error handling failed somehow
             if (error === null) setError('Failed to check authentication status.');
        }
        setIsLoading(false);
    }, [fetchAPI, error]); // Added 'error' dependency to potentially clear old errors if needed

    const handleLogin = () => {
        // Redirect to the backend login endpoint
        // This still needs the full base URL as it's a browser redirect, not an API call
        window.location.href = `${API_BASE_URL}/api/auth/login`;
    };

    const handleLogout = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setResults(null);
        try {
            // Use refactored fetchAPI - POST request for logout
            await fetchAPI('/auth/logout', { method: 'POST' });
            setIsLoggedIn(false);
            setUserData(null);
        } catch (err) {
            // Error should be set by fetchAPI
        }
        setIsLoading(false);
    }, [fetchAPI]); // Depends on fetchAPI

    // --- Conversion Handling ---
    const handleConvert = async (event) => {
        event.preventDefault();
        setIsConverting(true);
        setError(null);
        setResults(null);

        try {
             // Prepare data for Axios 'data' field
            const postData = {
                playlist_url: playlistUrl,
                playlist_name: playlistName || 'Converted YouTube Playlist', // Default name
            };

            // Use refactored fetchAPI
            const data = await fetchAPI('/convert', {
                method: 'POST',
                body: postData, // Pass data object to 'body' which fetchAPI maps to 'data'
            });

            // Response handling remains similar
            if (data && data.success) {
                setResults(data.data);
                setPlaylistUrl(''); // Clear form on success
                setPlaylistName('');
            } else if (data && data.error) {
                 setError(data.error);
                 if (data.data) {
                    setResults(data.data);
                 }
            } // else: axios error handling in fetchAPI covers network/5xx errors

        } catch (err) {
           // Error should be set by fetchAPI
           console.error("Error during conversion:", err);
        }
        setIsConverting(false);
    };

    // --- Effects --- 
    // Check auth status on initial load
    useEffect(() => {
        checkAuthStatus();
    }, [checkAuthStatus]);

    // Simple HTML escape helper
    const escapeHTML = (str) => {
        if (!str) return '';
        return str.replace(/[&<>'"/]/g, (match) => {
            const escape = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
                '/': '&#x2F;',
            };
            return escape[match];
        });
    };

    // --- Render Logic ---
    return (
        <div className="App">
            <header className="App-header">
                <h1>YouTube Music to Spotify Playlist Converter</h1>
                <div className="auth-section">
                    {isLoading && <p>Loading...</p>}
                    {!isLoading && isLoggedIn && userData && (
                        <div className="user-info">
                            <span>Logged in as <strong>{userData.display_name || userData.id}</strong></span>
                            <button onClick={handleLogout} disabled={isLoading}>Logout</button>
                        </div>
                    )}
                    {!isLoading && !isLoggedIn && (
                        <div className="login-prompt">
                            <p>Please log in with Spotify to convert playlists.</p>
                            <button onClick={handleLogin} disabled={isLoading}>Login with Spotify</button>
                        </div>
                    )}
                </div>
            </header>

            <main>
                {error && <div className="error-message">Error: {error}</div>}

                <form onSubmit={handleConvert} className={`conversion-form ${!isLoggedIn ? 'disabled' : ''}`}>
                    <div className="form-group">
                        <label htmlFor="playlist_url">YouTube Music Playlist URL:</label>
                        <input
                            type="url"
                            id="playlist_url"
                            value={playlistUrl}
                            onChange={(e) => setPlaylistUrl(e.target.value)}
                            placeholder="https://music.youtube.com/playlist?list=PL..."
                            required
                            disabled={!isLoggedIn || isConverting}
                        />
                        <small>Make sure the playlist is public.</small>
                    </div>
                    <div className="form-group">
                        <label htmlFor="playlist_name">New Spotify Playlist Name (Optional):</label>
                        <input
                            type="text"
                            id="playlist_name"
                            value={playlistName}
                            onChange={(e) => setPlaylistName(e.target.value)}
                            placeholder="My Awesome Converted Playlist"
                            disabled={!isLoggedIn || isConverting}
                        />
                    </div>
                    <button type="submit" disabled={!isLoggedIn || isConverting || !playlistUrl}>
                        {isConverting ? 'Converting...' : 'Convert Playlist'}
                    </button>
                </form>

                {results && (
                    <div className="results-section">
                        <h2>Conversion Results</h2>
                        <div className="result-summary">
                             {results.spotify_playlist_url ? (
                                 <p>Created Spotify playlist:
                                     <a href={results.spotify_playlist_url} target="_blank" rel="noopener noreferrer">
                                         {escapeHTML(results.spotify_playlist_name)}
                                     </a>
                                 </p>
                             ) : (
                                <p>Playlist creation may have failed, or no tracks were found to add.</p>
                             )}
                            <p>Processed {results.total_youtube_tracks ?? 'N/A'} tracks from YouTube.</p>
                            <p>Found {results.found_spotify_tracks ?? 'N/A'} matching tracks on Spotify.</p>
                            {results.spotify_playlist_url && <p>Added {results.tracks_added ?? 'N/A'} tracks to the new playlist.</p>}
                        </div>

                        {results.api_errors && results.api_errors.length > 0 && (
                            <div className="api-errors">
                                <h4>API Issues Encountered:</h4>
                                <ul>
                                    {results.api_errors.map((err, index) => (
                                        <li key={index}>{escapeHTML(err)}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {results.not_found_tracks && results.not_found_tracks.length > 0 && (
                            <div className="not-found">
                                <h4>Tracks Not Found on Spotify:</h4>
                                <ul>
                                    {results.not_found_tracks.map((track, index) => (
                                        <li key={index}>{escapeHTML(track)}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
