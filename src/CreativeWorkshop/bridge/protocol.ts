export const CREATIVE_WORKSHOP_BRIDGE_NAMESPACE = 'creative-workshop-bridge';

export type CreativeWorkshopBridgeRequestType =
  | 'bridge:handshake'
  | 'bridge:get-context'
  | 'bridge:list-installed-projects'
  | 'bridge:install-project'
  | 'bridge:uninstall-project'
  | 'bridge:get-project-diff'
  | 'bridge:confirm-project-update';

export type CreativeWorkshopBridgeResponseType =
  | 'bridge:handshake:ok'
  | 'bridge:context'
  | 'bridge:installed-projects'
  | 'bridge:install-result'
  | 'bridge:uninstall-result'
  | 'bridge:project-diff'
  | 'bridge:update-result'
  | 'bridge:error';

export type CreativeWorkshopBridgeMessage = {
  namespace: typeof CREATIVE_WORKSHOP_BRIDGE_NAMESPACE;
  type: CreativeWorkshopBridgeRequestType | CreativeWorkshopBridgeResponseType;
  requestId?: string;
  payload?: Record<string, unknown>;
};

export function isCreativeWorkshopBridgeMessage(value: unknown): value is CreativeWorkshopBridgeMessage {
  return (
    _.isObject(value) &&
    _.get(value, 'namespace') === CREATIVE_WORKSHOP_BRIDGE_NAMESPACE &&
    _.isString(_.get(value, 'type'))
  );
}

export function createBridgeMessage(
  type: CreativeWorkshopBridgeMessage['type'],
  payload?: Record<string, unknown>,
  requestId?: string,
): CreativeWorkshopBridgeMessage {
  return {
    namespace: CREATIVE_WORKSHOP_BRIDGE_NAMESPACE,
    type,
    requestId,
    payload,
  };
}
