import Fuse from 'fuse.js';
import { address as Address } from '../../generated/client/entities_prod';



/**
 * Merges similar addresses while preserving unique ones
 */
export function mergeSimilarAddresses(
  primaryAddresses: Address[],
  secondaryAddresses: Address[],
  options?: {
    similarityThreshold?: number;
  }
): Address[] {
  const similarityThreshold = options?.similarityThreshold ?? 0.5;

  // Configure Fuse.js for address matching
  const fuse = new Fuse(primaryAddresses, {
    keys: [
      { name: 'line_one', weight: 0.4 },
      { name: 'line_two', weight: 0.3 },
      { name: 'city', weight: 0.2 },
      { name: 'country_code', weight: 0.1 }
    ],
    includeScore: true,
    threshold: similarityThreshold,
    shouldSort: true
  });

  const merged = [...primaryAddresses];
  const usedIndices = new Set<number>();

  // Process each secondary address
  secondaryAddresses.forEach(secondaryAddr => {
    // Prepare a search object with only string values (no nulls)
    const searchObj: Record<string, string> = {
      line_one: secondaryAddr.line_one || '',
      line_two: secondaryAddr.line_two || '',
      city: secondaryAddr.city || '',
      country_code: secondaryAddr.country_code || ''
    };

    const bestMatch = fuse.search(searchObj)[0];
    
    if (bestMatch?.score && bestMatch.score <= similarityThreshold) {
      // Merge with existing address
      const primaryIndex = bestMatch.refIndex;
      merged[primaryIndex] = mergeAddressFields(merged[primaryIndex], secondaryAddr);
      usedIndices.add(primaryIndex);
    } else {
      // Add as new unique address
      merged.push(secondaryAddr);
    }
  });

  return merged;
}

/**
 * Merges fields from secondary address into primary address,
 * only replacing empty/null fields in primary with values from secondary
 */
function mergeAddressFields(primary: Address, secondary: Address): Address {
  return {
    ...primary,
    line_one: primary.line_one || secondary.line_one,
    line_two: primary.line_two || secondary.line_two,
    area: primary.area || secondary.area,
    city: primary.city || secondary.city,
    state: primary.state || secondary.state,
    zipcode: primary.zipcode || secondary.zipcode,
    // Preserve country_code from primary as it's more reliable
    // Add any other fields you want to merge
  };
}

