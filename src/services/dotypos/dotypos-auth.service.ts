/**
 * Dotypos Authentication Service
 * 
 * This service handles authentication with the Dotypos API using stored refresh tokens.
 * It manages access token lifecycle and provides authenticated API access.
 * 
 * Note: This uses pre-obtained refresh tokens from the one-time setup process.
 */

export interface DotyposTokenResponse {
  accessToken: string;
}

export interface DotyposConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  cloudId: string;
  apiUrl: string;
}

export class DotyposAuthService {
  private static instance: DotyposAuthService | null = null;
  private config: DotyposConfig;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  private constructor(config: DotyposConfig) {
    this.config = config;
    this.validateConfig();
  }

  /**
   * Get singleton instance of the auth service
   */
  public static getInstance(): DotyposAuthService {
    if (!DotyposAuthService.instance) {
      const config: DotyposConfig = {
        clientId: process.env.DOTYPOS_CLIENT_ID || '',
        clientSecret: process.env.DOTYPOS_CLIENT_SECRET || '',
        refreshToken: process.env.DOTYPOS_REFRESH_TOKEN || '',
        cloudId: process.env.DOTYPOS_CLOUD_ID || '',
        apiUrl: process.env.DOTYPOS_API_URL || 'https://api.dotykacka.cz/v2',
      };
      
      DotyposAuthService.instance = new DotyposAuthService(config);
    }
    
    return DotyposAuthService.instance;
  }

  /**
   * Validate that all required configuration is present
   */
  private validateConfig(): void {
    const missing: string[] = [];
    
    if (!this.config.clientId) missing.push('DOTYPOS_CLIENT_ID');
    if (!this.config.clientSecret) missing.push('DOTYPOS_CLIENT_SECRET');
    if (!this.config.refreshToken) missing.push('DOTYPOS_REFRESH_TOKEN');
    if (!this.config.cloudId) missing.push('DOTYPOS_CLOUD_ID');
    
    if (missing.length > 0) {
      throw new Error(
        `Missing required Dotypos configuration: ${missing.join(', ')}. ` +
        `Please run the setup at /admin/dotypos-setup to obtain these values.`
      );
    }
  }

  /**
   * Check if the service is properly configured
   */
  public isConfigured(): boolean {
    try {
      this.validateConfig();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  public async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    // Refresh the access token
    return this.refreshAccessToken();
  }

  /**
   * Refresh the access token using the stored refresh token
   */
  private async refreshAccessToken(): Promise<string> {
    try {
      const response = await fetch(`${this.config.apiUrl}/signin/token`, {
        method: 'POST',
        headers: {
          'Authorization': `User ${this.config.refreshToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          _cloudId: this.config.cloudId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to refresh access token: ${response.status} ${response.statusText}. ` +
          `Response: ${errorText}`
        );
      }

      const data: DotyposTokenResponse = await response.json();
      
      // Cache the token with 1-hour expiry (minus 1 minute buffer)
      this.accessToken = data.accessToken;
      this.tokenExpiry = Date.now() + (59 * 60 * 1000); // 59 minutes
      
      console.log('Dotypos access token refreshed successfully');
      
      return data.accessToken;
    } catch (error) {
      console.error('Error refreshing Dotypos access token:', error);
      throw new Error(
        `Unable to authenticate with Dotypos API. ` +
        `Please check your configuration and ensure the refresh token is valid.`
      );
    }
  }

  /**
   * Make an authenticated API request
   */
  public async makeAuthenticatedRequest<T = any>(
    method: string,
    endpoint: string,
    body?: any,
    options?: RequestInit
  ): Promise<T> {
    const token = await this.getAccessToken();
    
    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${this.config.apiUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Dotypos API request failed: ${response.status} ${response.statusText}. ` +
        `Response: ${errorText}`
      );
    }

    return response.json();
  }

  /**
   * Get the configured Cloud ID
   */
  public getCloudId(): string {
    return this.config.cloudId;
  }

  /**
   * Get the base API URL
   */
  public getApiUrl(): string {
    return this.config.apiUrl;
  }

  /**
   * Test the connection by attempting to get an access token
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch (error) {
      console.error('Dotypos connection test failed:', error);
      return false;
    }
  }
}

// Export singleton instance for convenience
export const dotyposAuth = DotyposAuthService.getInstance();