import { NextRequest, NextResponse } from 'next/server';
import { dotyposAuth } from '@/src/services/dotypos/dotypos-auth.service';

/**
 * Test endpoint for Dotypos authentication
 * GET /api/dotypos/test
 */
export async function GET(request: NextRequest) {
  try {
    // Check if the service is configured
    if (!dotyposAuth.isConfigured()) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Dotypos not configured',
          message: 'Please complete the setup at /admin/dotypos-setup first'
        },
        { status: 503 }
      );
    }

    // Test the connection
    const isConnected = await dotyposAuth.testConnection();
    
    if (!isConnected) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Connection failed',
          message: 'Unable to authenticate with Dotypos API'
        },
        { status: 502 }
      );
    }

    // Get an access token to verify it works
    const accessToken = await dotyposAuth.getAccessToken();
    
    // Try to fetch cloud information as a test
    const cloudId = dotyposAuth.getCloudId();
    const cloudInfo = await dotyposAuth.makeAuthenticatedRequest(
      'GET',
      `/clouds/${cloudId}`
    );

    return NextResponse.json({
      success: true,
      message: 'Dotypos authentication is working!',
      data: {
        cloudId,
        cloudInfo,
        tokenObtained: !!accessToken,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Dotypos test endpoint error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to test Dotypos connection'
      },
      { status: 500 }
    );
  }
}