export const DESIGNATION_GROUPS: [string, string[]][];
export const DESIGNATIONS: string[];
export const MANAGEMENT_DESIGNATIONS: string[];
export function accessForDesignation(designation: string | null | undefined): 'manager' | 'member' | 'viewer';
export const ACCESS_LEVELS: { id: 'admin' | 'manager' | 'member' | 'viewer'; label: string; blurb: string }[];
