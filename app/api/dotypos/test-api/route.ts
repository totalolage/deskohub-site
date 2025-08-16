import { NextRequest, NextResponse } from 'next/server';
import { Effect } from 'effect';
import { dotyposAPI } from '@/src/services/dotypos/dotypos-api.client';

/**
 * Test endpoint for the refactored Dotypos API client
 * GET /api/dotypos/test-api
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const operation = searchParams.get('op') || 'branches';

    let result: any;

    switch (operation) {
      case 'branches':
        // Test getting branches
        result = await Effect.runPromise(
          dotyposAPI.getBranches().pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                error: true,
                message: error.message || 'Failed to get branches',
                type: error._tag || 'Unknown',
              })
            )
          )
        );
        break;

      case 'tables':
        // Test getting tables
        const branchId = searchParams.get('branchId');
        result = await Effect.runPromise(
          dotyposAPI.getTables(branchId ? parseInt(branchId) : undefined).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                error: true,
                message: error.message || 'Failed to get tables',
                type: error._tag || 'Unknown',
              })
            )
          )
        );
        break;

      case 'customers':
        // Test searching customers
        const email = searchParams.get('email');
        const phone = searchParams.get('phone');
        result = await Effect.runPromise(
          dotyposAPI.searchCustomers({ email: email || undefined, phone: phone || undefined }).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                error: true,
                message: error.message || 'Failed to search customers',
                type: error._tag || 'Unknown',
              })
            )
          )
        );
        break;

      case 'reservations':
        // Test listing reservations
        result = await Effect.runPromise(
          dotyposAPI.listReservations({ limit: 10 }).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                error: true,
                message: error.message || 'Failed to list reservations',
                type: error._tag || 'Unknown',
              })
            )
          )
        );
        break;

      case 'create-reservation':
        // Test creating a reservation (with test data)
        const testReservation = {
          _branchId: 1,
          startDate: Date.now() + 24 * 60 * 60 * 1000, // Tomorrow
          endDate: Date.now() + 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000, // Tomorrow + 2 hours
          seats: 2,
          status: 'NEW' as const,
          note: 'Test reservation from API client',
        };
        
        result = await Effect.runPromise(
          dotyposAPI.createReservation(testReservation).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                error: true,
                message: error.message || 'Failed to create reservation',
                type: error._tag || 'Unknown',
              })
            )
          )
        );
        break;

      default:
        return NextResponse.json(
          { 
            error: 'Invalid operation',
            availableOperations: [
              'branches',
              'tables',
              'customers',
              'reservations',
              'create-reservation'
            ]
          },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      operation,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Dotypos API test error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to test Dotypos API'
      },
      { status: 500 }
    );
  }
}