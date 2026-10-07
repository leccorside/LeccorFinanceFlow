export type ServiceStatus = 'ok';

export interface HealthContract {
  status: ServiceStatus;
  service: 'leccor-finance-flow-api';
}
