import { chatActions } from "@penclipai/db";
import type { DbTransaction } from "../runtime-types.js";
import type { chatPublications } from "@penclipai/db";
export async function recordPhotonPublicationRetry(tx: DbTransaction, endpointId: string, publication: typeof chatPublications.$inferSelect, userId: string): Promise<void> {
  await tx
    .insert(chatActions)
    .values({
      companyId: publication.companyId,
      endpointId,
      conversationId: publication.conversationId,
      kind: "photon_publication_retry",
      providerActionId: `photon-retry:${publication.id}:${publication.attempts + 1}`,
      payload: {
        publicationId: publication.id,
        attempt: publication.attempts + 1,
      },
      result: { authorizedByUserId: userId },
      status: "processed",
    })
    .onConflictDoNothing();
}
