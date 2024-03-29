import { delay } from '@whiskeysockets/baileys';
import { isURL } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import { v4 } from 'uuid';

import { ConfigService, HttpServer, WaBusiness } from '../../config/env.config';
import { Logger } from '../../config/logger.config';
import { BadRequestException, InternalServerErrorException } from '../../exceptions';
import { RedisCache } from '../../libs/redis.client';
import { InstanceDto } from '../dto/instance.dto';
import { RepositoryBroker } from '../repository/repository.manager';
import { AuthService, OldToken } from '../services/auth.service';
import { CacheService } from '../services/cache.service';
import { ChatwootService } from '../services/chatwoot.service';
import { IntegrationService } from '../services/integration.service';
import { WAMonitoringService } from '../services/monitor.service';
import { RabbitmqService } from '../services/rabbitmq.service';
import { SettingsService } from '../services/settings.service';
import { SqsService } from '../services/sqs.service';
import { TypebotService } from '../services/typebot.service';
import { WebhookService } from '../services/webhook.service';
import { WebsocketService } from '../services/websocket.service';
import { BaileysStartupService } from '../services/whatsapp.baileys.service';
import { BusinessStartupService } from '../services/whatsapp.business.service';
import { Events, Integration, wa } from '../types/wa.types';

export class InstanceController {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly repository: RepositoryBroker,
    private readonly eventEmitter: EventEmitter2,
    private readonly authService: AuthService,
    private readonly webhookService: WebhookService,
    private readonly chatwootService: ChatwootService,
    private readonly settingsService: SettingsService,
    private readonly websocketService: WebsocketService,
    private readonly rabbitmqService: RabbitmqService,
    private readonly sqsService: SqsService,
    private readonly typebotService: TypebotService,
    private readonly integrationService: IntegrationService,
    private readonly cache: RedisCache,
    private readonly chatwootCache: CacheService,
  ) {}

  private readonly logger = new Logger(InstanceController.name);

  public async createInstance({
    instanceName,
    webhook,
    webhook_by_events,
    webhook_base64,
    events,
    qrcode,
    number,
    integration,
    token,
    chatwoot_account_id,
    chatwoot_token,
    chatwoot_url,
    chatwoot_sign_msg,
    chatwoot_reopen_conversation,
    chatwoot_conversation_pending,
    chatwoot_import_contacts,
    chatwoot_import_messages,
    chatwoot_days_limit_import_messages,
    reject_call,
    msg_call,
    groups_ignore,
    always_online,
    read_messages,
    read_status,
    sync_full_history,
    websocket_enabled,
    websocket_events,
    rabbitmq_enabled,
    rabbitmq_events,
    sqs_enabled,
    sqs_events,
    typebot_url,
    typebot,
    typebot_expire,
    typebot_keyword_finish,
    typebot_delay_message,
    typebot_unknown_message,
    typebot_listening_from_me,
  }: InstanceDto) {
    try {
      this.logger.verbose('requested createInstance from ' + instanceName + ' instance');

      this.logger.verbose('checking duplicate token');
      await this.authService.checkDuplicateToken(token);

      if (!token && integration === Integration.WHATSAPP_BUSINESS) {
        throw new BadRequestException('token is required');
      }

      this.logger.verbose('creating instance');
      let instance: BaileysStartupService | BusinessStartupService;
      if (integration === Integration.WHATSAPP_BUSINESS) {
        instance = new BusinessStartupService(
          this.configService,
          this.eventEmitter,
          this.repository,
          this.cache,
          this.chatwootCache,
        );
      } else {
        instance = new BaileysStartupService(
          this.configService,
          this.eventEmitter,
          this.repository,
          this.cache,
          this.chatwootCache,
        );
      }

      await this.waMonitor.saveInstance({ integration, instanceName, token, number });

      instance.instanceName = instanceName;

      const instanceId = v4();

      instance.sendDataWebhook(Events.INSTANCE_CREATE, {
        instanceName,
        instanceId: instanceId,
      });

      this.logger.verbose('instance: ' + instance.instanceName + ' created');

      this.waMonitor.waInstances[instance.instanceName] = instance;
      this.waMonitor.delInstanceTime(instance.instanceName);

      this.logger.verbose('generating hash');
      const hash = await this.authService.generateHash(
        {
          instanceName: instance.instanceName,
          instanceId: instanceId,
        },
        token,
      );

      this.logger.verbose('hash: ' + hash + ' generated');

      let webhookEvents: string[];

      if (webhook) {
        if (!isURL(webhook, { require_tld: false })) {
          throw new BadRequestException('Invalid "url" property in webhook');
        }

        this.logger.verbose('creating webhook');
        try {
          let newEvents: string[] = [];
          if (!events || events.length === 0) {
            newEvents = [
              'APPLICATION_STARTUP',
              'QRCODE_UPDATED',
              'MESSAGES_SET',
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'MESSAGES_DELETE',
              'SEND_MESSAGE',
              'CONTACTS_SET',
              'CONTACTS_UPSERT',
              'CONTACTS_UPDATE',
              'PRESENCE_UPDATE',
              'CHATS_SET',
              'CHATS_UPSERT',
              'CHATS_UPDATE',
              'CHATS_DELETE',
              'GROUPS_UPSERT',
              'GROUP_UPDATE',
              'GROUP_PARTICIPANTS_UPDATE',
              'CONNECTION_UPDATE',
              'LABELS_EDIT',
              'LABELS_ASSOCIATION',
              'CALL',
              'NEW_JWT_TOKEN',
              'TYPEBOT_START',
              'TYPEBOT_CHANGE_STATUS',
              'CHAMA_AI_ACTION',
            ];
          } else {
            newEvents = events;
          }
          this.webhookService.create(instance, {
            enabled: true,
            url: webhook,
            events: newEvents,
            webhook_by_events,
            webhook_base64,
          });

          webhookEvents = (await this.webhookService.find(instance)).events;
        } catch (error) {
          this.logger.log(error);
        }
      }

      let websocketEvents: string[];

      if (websocket_enabled) {
        this.logger.verbose('creating websocket');
        try {
          let newEvents: string[] = [];
          if (websocket_events.length === 0) {
            newEvents = [
              'APPLICATION_STARTUP',
              'QRCODE_UPDATED',
              'MESSAGES_SET',
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'MESSAGES_DELETE',
              'SEND_MESSAGE',
              'CONTACTS_SET',
              'CONTACTS_UPSERT',
              'CONTACTS_UPDATE',
              'PRESENCE_UPDATE',
              'CHATS_SET',
              'CHATS_UPSERT',
              'CHATS_UPDATE',
              'CHATS_DELETE',
              'GROUPS_UPSERT',
              'GROUP_UPDATE',
              'GROUP_PARTICIPANTS_UPDATE',
              'CONNECTION_UPDATE',
              'LABELS_EDIT',
              'LABELS_ASSOCIATION',
              'CALL',
              'NEW_JWT_TOKEN',
              'TYPEBOT_START',
              'TYPEBOT_CHANGE_STATUS',
              'CHAMA_AI_ACTION',
            ];
          } else {
            newEvents = websocket_events;
          }
          this.websocketService.create(instance, {
            enabled: true,
            events: newEvents,
          });

          websocketEvents = (await this.websocketService.find(instance)).events;
        } catch (error) {
          this.logger.log(error);
        }
      }

      let rabbitmqEvents: string[];

      if (rabbitmq_enabled) {
        this.logger.verbose('creating rabbitmq');
        try {
          let newEvents: string[] = [];
          if (rabbitmq_events.length === 0) {
            newEvents = [
              'APPLICATION_STARTUP',
              'QRCODE_UPDATED',
              'MESSAGES_SET',
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'MESSAGES_DELETE',
              'SEND_MESSAGE',
              'CONTACTS_SET',
              'CONTACTS_UPSERT',
              'CONTACTS_UPDATE',
              'PRESENCE_UPDATE',
              'CHATS_SET',
              'CHATS_UPSERT',
              'CHATS_UPDATE',
              'CHATS_DELETE',
              'GROUPS_UPSERT',
              'GROUP_UPDATE',
              'GROUP_PARTICIPANTS_UPDATE',
              'CONNECTION_UPDATE',
              'LABELS_EDIT',
              'LABELS_ASSOCIATION',
              'CALL',
              'NEW_JWT_TOKEN',
              'TYPEBOT_START',
              'TYPEBOT_CHANGE_STATUS',
              'CHAMA_AI_ACTION',
            ];
          } else {
            newEvents = rabbitmq_events;
          }
          this.rabbitmqService.create(instance, {
            enabled: true,
            events: newEvents,
          });

          rabbitmqEvents = (await this.rabbitmqService.find(instance)).events;
        } catch (error) {
          this.logger.log(error);
        }
      }

      let sqsEvents: string[];

      if (sqs_enabled) {
        this.logger.verbose('creating sqs');
        try {
          let newEvents: string[] = [];
          if (sqs_events.length === 0) {
            newEvents = [
              'APPLICATION_STARTUP',
              'QRCODE_UPDATED',
              'MESSAGES_SET',
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'MESSAGES_DELETE',
              'SEND_MESSAGE',
              'CONTACTS_SET',
              'CONTACTS_UPSERT',
              'CONTACTS_UPDATE',
              'PRESENCE_UPDATE',
              'CHATS_SET',
              'CHATS_UPSERT',
              'CHATS_UPDATE',
              'CHATS_DELETE',
              'GROUPS_UPSERT',
              'GROUP_UPDATE',
              'GROUP_PARTICIPANTS_UPDATE',
              'CONNECTION_UPDATE',
              'LABELS_EDIT',
              'LABELS_ASSOCIATION',
              'CALL',
              'NEW_JWT_TOKEN',
              'TYPEBOT_START',
              'TYPEBOT_CHANGE_STATUS',
              'CHAMA_AI_ACTION',
            ];
          } else {
            newEvents = sqs_events;
          }
          this.sqsService.create(instance, {
            enabled: true,
            events: newEvents,
          });

          sqsEvents = (await this.sqsService.find(instance)).events;
        } catch (error) {
          this.logger.log(error);
        }
      }

      if (typebot_url) {
        try {
          if (!isURL(typebot_url, { require_tld: false })) {
            throw new BadRequestException('Invalid "url" property in typebot_url');
          }

          this.logger.verbose('creating typebot');

          this.typebotService.create(instance, {
            enabled: true,
            url: typebot_url,
            typebot: typebot,
            expire: typebot_expire,
            keyword_finish: typebot_keyword_finish,
            delay_message: typebot_delay_message,
            unknown_message: typebot_unknown_message,
            listening_from_me: typebot_listening_from_me,
          });
        } catch (error) {
          this.logger.log(error);
        }
      }

      this.logger.verbose('creating settings');
      const settings: wa.LocalSettings = {
        reject_call: reject_call || false,
        msg_call: msg_call || '',
        groups_ignore: groups_ignore ?? true,
        always_online: always_online || false,
        read_messages: read_messages || false,
        read_status: read_status || false,
        sync_full_history: sync_full_history ?? false,
      };

      this.logger.verbose('settings: ' + JSON.stringify(settings));

      this.settingsService.create(instance, settings);

      let webhook_wa_business = null,
        access_token_wa_business = '';

      if (integration === Integration.WHATSAPP_BUSINESS) {
        if (!number) {
          throw new BadRequestException('number is required');
        }
        const urlServer = this.configService.get<HttpServer>('SERVER').URL;
        const webHookTest = this.configService.get<WaBusiness>('WA_BUSINESS').WEBHOOK_TEST;
        webhook_wa_business = `${webHookTest ? webHookTest : urlServer}/webhook/whatsapp`;
        access_token_wa_business = this.configService.get<WaBusiness>('WA_BUSINESS').TOKEN_WEBHOOK;
      }

      this.integrationService.create(instance, {
        integration,
        number,
        token,
      });
      if (!chatwoot_account_id || !chatwoot_token || !chatwoot_url) {
        let getQrcode: wa.QrCode;

        if (qrcode) {
          this.logger.verbose('creating qrcode');
          await instance.connectToWhatsapp(number);
          await delay(5000);
          getQrcode = instance.qrCode;
        }

        const result = {
          instance: {
            instanceName: instance.instanceName,
            instanceId: instanceId,
            integration: integration,
            webhook_wa_business,
            access_token_wa_business,
            status: 'created',
          },
          hash,
          webhook: {
            webhook,
            webhook_by_events,
            webhook_base64,
            events: webhookEvents,
          },
          websocket: {
            enabled: websocket_enabled,
            events: websocketEvents,
          },
          rabbitmq: {
            enabled: rabbitmq_enabled,
            events: rabbitmqEvents,
          },
          sqs: {
            enabled: sqs_enabled,
            events: sqsEvents,
          },
          typebot: {
            enabled: typebot_url ? true : false,
            url: typebot_url,
            typebot,
            expire: typebot_expire,
            keyword_finish: typebot_keyword_finish,
            delay_message: typebot_delay_message,
            unknown_message: typebot_unknown_message,
            listening_from_me: typebot_listening_from_me,
          },
          settings,
          qrcode: getQrcode,
        };

        this.logger.verbose('instance created');
        this.logger.verbose(result);

        return result;
      }

      if (!chatwoot_account_id) {
        throw new BadRequestException('account_id is required');
      }

      if (!chatwoot_token) {
        throw new BadRequestException('token is required');
      }

      if (!chatwoot_url) {
        throw new BadRequestException('url is required');
      }

      if (!isURL(chatwoot_url, { require_tld: false })) {
        throw new BadRequestException('Invalid "url" property in chatwoot');
      }

      if (chatwoot_sign_msg !== true && chatwoot_sign_msg !== false) {
        throw new BadRequestException('sign_msg is required');
      }

      if (chatwoot_reopen_conversation !== true && chatwoot_reopen_conversation !== false) {
        throw new BadRequestException('reopen_conversation is required');
      }

      if (chatwoot_conversation_pending !== true && chatwoot_conversation_pending !== false) {
        throw new BadRequestException('conversation_pending is required');
      }

      const urlServer = this.configService.get<HttpServer>('SERVER').URL;

      try {
        this.chatwootService.create(instance, {
          enabled: true,
          account_id: chatwoot_account_id,
          token: chatwoot_token,
          url: chatwoot_url,
          sign_msg: chatwoot_sign_msg || false,
          name_inbox: instance.instanceName.split('-cwId-')[0],
          number,
          reopen_conversation: chatwoot_reopen_conversation || false,
          conversation_pending: chatwoot_conversation_pending || false,
          import_contacts: chatwoot_import_contacts ?? true,
          import_messages: chatwoot_import_messages ?? true,
          days_limit_import_messages: chatwoot_days_limit_import_messages ?? 60,
          auto_create: true,
        });
      } catch (error) {
        this.logger.log(error);
      }

      return {
        instance: {
          instanceName: instance.instanceName,
          instanceId: instanceId,
          integration: integration,
          webhook_wa_business,
          access_token_wa_business,
          status: 'created',
        },
        hash,
        webhook: {
          webhook,
          webhook_by_events,
          webhook_base64,
          events: webhookEvents,
        },
        websocket: {
          enabled: websocket_enabled,
          events: websocketEvents,
        },
        rabbitmq: {
          enabled: rabbitmq_enabled,
          events: rabbitmqEvents,
        },
        sqs: {
          enabled: sqs_enabled,
          events: sqsEvents,
        },
        typebot: {
          enabled: typebot_url ? true : false,
          url: typebot_url,
          typebot,
          expire: typebot_expire,
          keyword_finish: typebot_keyword_finish,
          delay_message: typebot_delay_message,
          unknown_message: typebot_unknown_message,
          listening_from_me: typebot_listening_from_me,
        },
        settings,
        chatwoot: {
          enabled: true,
          account_id: chatwoot_account_id,
          token: chatwoot_token,
          url: chatwoot_url,
          sign_msg: chatwoot_sign_msg || false,
          reopen_conversation: chatwoot_reopen_conversation || false,
          conversation_pending: chatwoot_conversation_pending || false,
          import_contacts: chatwoot_import_contacts ?? true,
          import_messages: chatwoot_import_messages ?? true,
          days_limit_import_messages: chatwoot_days_limit_import_messages || 60,
          number,
          name_inbox: instance.instanceName,
          webhook_url: `${urlServer}/chatwoot/webhook/${encodeURIComponent(instance.instanceName)}`,
        },
      };
    } catch (error) {
      this.logger.error(error.message[0]);
      throw new BadRequestException(error.message[0]);
    }
  }

  public async connectToWhatsapp({ instanceName, number = null }: InstanceDto) {
    try {
      this.logger.verbose('requested connectToWhatsapp from ' + instanceName + ' instance');

      const instance = this.waMonitor.waInstances[instanceName];
      const state = instance?.connectionStatus?.state;

      this.logger.verbose('state: ' + state);

      if (!state) {
        throw new BadRequestException('The "' + instanceName + '" instance does not exist');
      }

      if (state == 'open') {
        return await this.connectionState({ instanceName });
      }

      if (state == 'connecting') {
        return instance.qrCode;
      }

      if (state == 'close') {
        this.logger.verbose('connecting');
        await instance.connectToWhatsapp(number);

        await delay(5000);
        return instance.qrCode;
      }

      return {
        instance: {
          instanceName: instanceName,
          status: state,
        },
        qrcode: instance?.qrCode,
      };
    } catch (error) {
      this.logger.error(error);
    }
  }

  public async restartInstance({ instanceName }: InstanceDto) {
    try {
      this.logger.verbose('requested restartInstance from ' + instanceName + ' instance');

      const instance = this.waMonitor.waInstances[instanceName];
      const state = instance?.connectionStatus?.state;

      switch (state) {
        case 'open':
          this.logger.verbose('logging out instance: ' + instanceName);
          instance.clearCacheChatwoot();
          await instance.reloadConnection();
          await delay(2000);

          return await this.connectionState({ instanceName });
        default:
          return await this.connectionState({ instanceName });
      }
    } catch (error) {
      this.logger.error(error);
    }
  }

  public async connectionState({ instanceName }: InstanceDto) {
    this.logger.verbose('requested connectionState from ' + instanceName + ' instance');
    return {
      instance: {
        instanceName: instanceName,
        state: this.waMonitor.waInstances[instanceName]?.connectionStatus?.state,
      },
    };
  }

  public async fetchInstances({ instanceName, instanceId, number }: InstanceDto) {
    if (instanceName) {
      this.logger.verbose('requested fetchInstances from ' + instanceName + ' instance');
      this.logger.verbose('instanceName: ' + instanceName);
      return this.waMonitor.instanceInfo(instanceName);
    } else if (instanceId || number) {
      return this.waMonitor.instanceInfoById(instanceId, number);
    }

    this.logger.verbose('requested fetchInstances (all instances)');
    return this.waMonitor.instanceInfo();
  }

  public async logout({ instanceName }: InstanceDto) {
    this.logger.verbose('requested logout from ' + instanceName + ' instance');
    const { instance } = await this.connectionState({ instanceName });

    if (instance.state === 'close') {
      throw new BadRequestException('The "' + instanceName + '" instance is not connected');
    }

    try {
      this.waMonitor.waInstances[instanceName]?.logoutInstance();

      return { status: 'SUCCESS', error: false, response: { message: 'Instance logged out' } };
    } catch (error) {
      throw new InternalServerErrorException(error.toString());
    }
  }

  public async deleteInstance({ instanceName }: InstanceDto) {
    this.logger.verbose('requested deleteInstance from ' + instanceName + ' instance');
    const { instance } = await this.connectionState({ instanceName });

    if (instance.state === 'open') {
      throw new BadRequestException('The "' + instanceName + '" instance needs to be disconnected');
    }
    try {
      this.waMonitor.waInstances[instanceName]?.removeRabbitmqQueues();
      this.waMonitor.waInstances[instanceName]?.clearCacheChatwoot();

      if (instance.state === 'connecting') {
        this.logger.verbose('logging out instance: ' + instanceName);

        await this.logout({ instanceName });
      }

      this.logger.verbose('deleting instance: ' + instanceName);

      try {
        this.waMonitor.waInstances[instanceName].sendDataWebhook(Events.INSTANCE_DELETE, {
          instanceName,
          instanceId: (await this.repository.auth.find(instanceName))?.instanceId,
        });
      } catch (error) {
        this.logger.error(error);
      }

      delete this.waMonitor.waInstances[instanceName];
      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
      return { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } };
    } catch (error) {
      throw new BadRequestException(error.toString());
    }
  }

  public async refreshToken(_: InstanceDto, oldToken: OldToken) {
    this.logger.verbose('requested refreshToken');
    return await this.authService.refreshToken(oldToken);
  }
}
