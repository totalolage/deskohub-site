/**
 * TypeScript declaration for Intl.NumberFormat formatRange method
 * This extends the global Intl namespace to include the formatRange method
 * which is available in modern browsers but not yet in TypeScript's lib definitions
 */

declare global {
  namespace Intl {
    interface NumberFormat {
      /**
       * Formats a range of numbers according to the locale and formatting options
       * of this Intl.NumberFormat object.
       *
       * @param startRange - The start of the range (Number, BigInt, or string)
       * @param endRange - The end of the range (Number, BigInt, or string)
       * @returns A string representing the given range of numbers formatted according to the locale
       *
       * @throws {RangeError} Thrown if either startRange or endRange is NaN or an inconvertible string
       * @throws {TypeError} Thrown if either startRange or endRange is undefined
       *
       * @example
       * const nf = new Intl.NumberFormat("en-US", {
       *   style: "currency",
       *   currency: "USD",
       * });
       * console.log(nf.formatRange(3, 5)); // "$3 – $5"
       * console.log(nf.formatRange(2.9, 3.1)); // "~$3"
       */
      formatRange?(
        startRange: number | bigint,
        endRange: number | bigint
      ): string;

      /**
       * Returns an array of objects containing the locale-specific tokens
       * from which it is possible to build custom strings while preserving
       * the locale-specific parts.
       *
       * @param startRange - The start of the range (Number, BigInt, or string)
       * @param endRange - The end of the range (Number, BigInt, or string)
       * @returns An array of NumberFormatPart objects
       *
       * @throws {RangeError} Thrown if either startRange or endRange is NaN or an inconvertible string
       * @throws {TypeError} Thrown if either startRange or endRange is undefined
       */
      formatRangeToParts?(
        startRange: number | bigint,
        endRange: number | bigint
      ): NumberFormatPart[];
    }

    /**
     * Part of a formatted number range
     */
    interface NumberFormatPart {
      type: string;
      value: string;
      source?: "startRange" | "endRange" | "shared";
    }
  }
}

// This export is required for module augmentation to work properly
export {};
