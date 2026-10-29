/** A confirmation is valid only for the exact current synthetic recipient version. */
export function recipientReady(r:{id:string;version:number;identityStatus?:'verified'|'needs_review';verifiedVersion?:number}){
 return r.id==='self'||r.identityStatus==='verified'&&r.verifiedVersion===r.version;
}
