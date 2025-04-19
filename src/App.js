import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

// Use the environment variable defined in frontend/.env
// Fallback for safety, though proxy should handle base URL in dev
const API_BASE_URL = process.env.REACT_APP_BACKEND_API_BASE_URL || '';

function App() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [userData, setUserData] = useState(null);
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [playlistName, setPlaylistName] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isConverting, setIsConverting] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState(null);

    // --- API Interaction Logic ---
    const fetchAPI = useCallback(async (endpoint, options = {}) => {
        const config = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                // Add other headers if needed
            },
            credentials: 'include', // Crucial for sending session cookies
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        };

        // Use relative path, letting the proxy handle it in development
        // const url = `/api${endpoint}`; // Note: No base URL needed due to proxy
        // Construct the full URL using the base URL
        const url = `${API_BASE_URL}/api${endpoint}`;

        try {
            const response = await fetch(url, config);

            // Handle non-JSON/empty responses (like logout)
            if (!response.headers.get("content-type")?.includes("application/json")) {
                 if (response.ok) {
                     return { success: true }; // Or handle based on status code if needed
                 } else {
                     throw new Error(`HTTP error! status: ${response.status}`);
                 }
            }

            const data = await response.json();

            if (!response.ok) {
                console.error('API Error Response:', data);
                // Handle specific auth error
                if (response.status === 401 || data.auth_required) {
                    setIsLoggedIn(false);
                    setUserData(null);
                    throw new Error(data.error || 'Authentication required. Please log in.');
                }
                // Throw general error for other non-ok responses
                throw new Error(data.message || data.error || `Request failed with status ${response.status}`);
            }

            return data;
        } catch (err) {
            console.error('Fetch API Error:', err);
            setError(err.message || 'An unexpected error occurred.');
            setIsLoading(false); // Ensure loading stops on error
            setIsConverting(false);
            return null; // Indicate failure
        }
    }, []); // Empty dependency array: fetchAPI itself doesn't depend on component state

    // --- Authentication Handling ---
    const checkAuthStatus = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setResults(null);
        console.log("Checking auth status...");
        try {
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
            }
        } catch (err) {
            // Error is set within fetchAPI
             console.error("Error in checkAuthStatus catch block:", err);
             setIsLoggedIn(false);
             setUserData(null);
        }
        setIsLoading(false);
    }, [fetchAPI]); // Depends on fetchAPI

    const handleLogin = () => {
        // Redirect to the backend login endpoint
        window.location.href = `${API_BASE_URL}/api/auth/login`;
    };

    const handleLogout = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setResults(null);
        try {
            await fetchAPI('/auth/logout');
            setIsLoggedIn(false);
            setUserData(null);
        } catch (err) {
            // Error set by fetchAPI
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
            const body = JSON.stringify({
                playlist_url: playlistUrl,
                playlist_name: playlistName || 'Converted YouTube Playlist', // Default name
            });

            const data = await fetchAPI('/convert', {
                method: 'POST',
                body: body,
            });

            if (data && data.success) {
                setResults(data.data);
                setPlaylistUrl(''); // Clear form on success
                setPlaylistName('');
            } else if (data && data.error) {
                // Handle specific conversion errors returned successfully (e.g., 404 not found)
                 setError(data.error);
                 if (data.data) { // Display partial data if available (like not found tracks)
                    setResults(data.data);
                 }
            } // else: fetchAPI would have thrown for network/5xx errors

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
