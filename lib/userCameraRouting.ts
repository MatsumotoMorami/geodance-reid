import type { CameraDef } from "./cameras";
import type { PublicUser } from "./authStore";

export function backendNamespaceForUser(user: Pick<PublicUser, "id" | "camerasUpdatedAt">): string {
  return `user:${user.id}:${user.camerasUpdatedAt}`;
}

export function backendCameraPrefix(user: Pick<PublicUser, "id">): string {
  return `u_${user.id}__`;
}

export function backendCameraIdForUser(user: Pick<PublicUser, "id">, cameraId: string): string {
  return `${backendCameraPrefix(user)}${cameraId}`;
}

export function toBackendCameras(user: PublicUser): Array<{ id: string; url: string }> {
  return user.cameras.map((cam) => ({
    id: backendCameraIdForUser(user, cam.id),
    url: cam.rtspPath,
  }));
}

export function findUserCamera(user: PublicUser, cameraId: string): CameraDef | undefined {
  return user.cameras.find((cam) => cam.id === cameraId);
}

