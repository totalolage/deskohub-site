"use server";

import { type } from 'arktype';

// Define validation schema with arktype
const bookingSchema = type({
  date: 'string>=1', // Non-empty string
  time: 'string>=1', // Non-empty string
  guestCount: 'number>0', // Positive number
  name: 'string>=1', // Non-empty string
  email: 'string>=1', // Non-empty string (basic validation)
  phone: 'string>=1', // Non-empty string
  tablePreference: 'string?',
  specialRequests: 'string?',
  preOrders: 'string?'
});

// Type definitions for better type safety
type BookingFormData = {
  date: string;
  time: string;
  guestCount: number;
  name: string;
  email: string;
  phone: string;
  tablePreference: string;
  specialRequests: string;
  preOrders: string;
};

type ActionState = {
  success: boolean;
  message: string;
  errors: Record<string, string>;
  data?: BookingFormData;
};

// More reliable form data extraction
function extractFormData(formData: FormData): BookingFormData {
  const getValue = (key: string): string => {
    const value = formData.get(key);
    return value === null ? '' : String(value);
  };

  const getNumberValue = (key: string): number => {
    const value = formData.get(key);
    const num = value === null ? 0 : Number(value);
    return isNaN(num) ? 0 : num;
  };

  return {
    date: getValue('date'),
    time: getValue('time'),
    guestCount: getNumberValue('guestCount'),
    name: getValue('name'),
    email: getValue('email'),
    phone: getValue('phone'),
    tablePreference: getValue('tablePreference'),
    specialRequests: getValue('specialRequests'),
    preOrders: getValue('preOrders'),
  };
}

// Server action with useActionState-compatible signature
export async function submitBooking(prevState: ActionState, formData: FormData): Promise<ActionState> {
  try {
    // Extract form data using reliable method
    const rawFormData = extractFormData(formData);
    
    // Debug: Log the extracted data
    console.log('Raw form data:', rawFormData);

    // Validate with arktype
    const validatedData = bookingSchema(rawFormData);
    
    // Debug: Log validation result
    console.log('Validation result:', validatedData);
    console.log('Has problems:', !!validatedData.problems);
    
    if (validatedData.problems) {
      console.log('Validation problems:', validatedData.problems);
      const errors = validatedData.problems.reduce((acc: Record<string, string>, problem) => {
        const field = problem.path?.[0] || 'general';
        // Convert arktype error messages to user-friendly messages
        let userMessage = problem.message;
        if (problem.message.includes('must be more than 0')) {
          switch (field) {
            case 'date': userMessage = 'Date is required'; break;
            case 'time': userMessage = 'Time is required'; break;
            case 'guestCount': userMessage = 'Number of guests is required'; break;
            case 'name': userMessage = 'Name is required'; break;
            case 'email': userMessage = 'Email is required'; break;
            case 'phone': userMessage = 'Phone number is required'; break;
            default: userMessage = 'This field is required';
          }
        }
        acc[field] = userMessage;
        return acc;
      }, {});
      
      console.log('Processed errors:', errors);
      
      return {
        success: false,
        errors,
        message: 'Please fix the validation errors',
      };
    }

    // TODO: Implement actual booking logic (connect to AirTable in future)
    console.log('Booking submitted:', validatedData.data);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      message: 'Booking submitted successfully',
      errors: {},
      data: validatedData.data,
    };
    
  } catch (error) {
    console.error('Booking submission error:', error);
    return {
      success: false,
      message: 'Failed to process booking request',
      errors: {},
    };
  }
}