import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { CustomerContactOrmEntity } from '../infra/typeorm/entities/customer-contact.orm-entity';
import {
  CustomerContractOrmEntity,
  CustomerContractStatus,
} from '../infra/typeorm/entities/customer-contract.orm-entity';
import { CustomerTimelineEntryOrmEntity } from '../infra/typeorm/entities/customer-timeline-entry.orm-entity';
import {
  CustomerEnvironment,
  CustomerOrmEntity,
  CustomerStage,
} from '../infra/typeorm/entities/customer.orm-entity';
import { LicensingAdminClient } from '../infra/licensing/licensing-admin.client';
import type {
  CreateCustomerBody,
  CreateCustomerContactBody,
  CreateCustomerContractBody,
  CreateCustomerTimelineEntryBody,
  UpdateCustomerBody,
  UpdateCustomerContractBody,
} from './customer.contracts';

interface LicensePlanListResponse {
  plans: Array<{
    id: string;
    name: string;
    active: boolean;
  }>;
}

export interface ActivateLicenseResponse {
  licenseInstanceId: string;
  licenseKey: string;
  licenseToken: string;
  installationFingerprint: string;
  status: string;
  version: number;
  expiresAt: string;
  gracePeriodUntil: string;
  entitlements: Record<string, boolean | number | string>;
  signature: string;
}

interface ActiveContractLicenseResponse {
  license: ActivateLicenseResponse | null;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CustomerOrmEntity)
    private readonly customers: Repository<CustomerOrmEntity>,
    @InjectRepository(CustomerContactOrmEntity)
    private readonly contacts: Repository<CustomerContactOrmEntity>,
    @InjectRepository(CustomerTimelineEntryOrmEntity)
    private readonly timeline: Repository<CustomerTimelineEntryOrmEntity>,
    @InjectRepository(CustomerContractOrmEntity)
    private readonly contracts: Repository<CustomerContractOrmEntity>,
    private readonly licensing: LicensingAdminClient,
  ) {}

  async list(filters: { search?: string; stage?: string; environment?: string }) {
    const where: FindOptionsWhere<CustomerOrmEntity>[] = [];
    const common: FindOptionsWhere<CustomerOrmEntity> = {};

    if (filters.stage && filters.stage !== 'todas') {
      common.stage = filters.stage as CustomerStage;
    }
    if (filters.environment && filters.environment !== 'todos') {
      common.expectedEnvironment = filters.environment as CustomerEnvironment;
    }

    if (filters.search?.trim()) {
      const search = `%${filters.search.trim()}%`;
      where.push(
        { ...common, name: ILike(search) },
        { ...common, segment: ILike(search) },
        { ...common, commercialOwner: ILike(search) },
      );
    } else {
      where.push(common);
    }

    const customers = await this.customers.find({
      where,
      relations: { contacts: true, timeline: true, contracts: true },
      order: { updatedAt: 'DESC' },
    });

    return customers.map((customer) => this.toResponse(customer));
  }

  async getById(id: string) {
    const customer = await this.findById(id);
    return this.toResponse(customer);
  }

  async create(body: CreateCustomerBody) {
    const customer = this.customers.create({
      name: body.name,
      type: body.type,
      stage: body.stage,
      legalName: body.legalName ?? null,
      document: body.document ?? null,
      segment: body.segment ?? null,
      website: body.website ?? null,
      commercialOwner: body.commercialOwner ?? null,
      priority: body.priority,
      expectedValue: body.expectedValue ?? null,
      expectedEnvironment: body.expectedEnvironment,
      technicalOwner: body.technicalOwner ?? null,
      notes: body.notes ?? null,
      contacts: body.contacts.map((contact) => this.contacts.create(this.mapContactBody(contact))),
    });

    const saved = await this.customers.save(customer);
    return this.getById(saved.id);
  }

  async update(id: string, body: UpdateCustomerBody) {
    const customer = await this.findById(id);

    Object.assign(customer, {
      name: body.name ?? customer.name,
      type: body.type ?? customer.type,
      stage: body.stage ?? customer.stage,
      legalName: body.legalName === undefined ? customer.legalName : body.legalName,
      document: body.document === undefined ? customer.document : body.document,
      segment: body.segment === undefined ? customer.segment : body.segment,
      website: body.website === undefined ? customer.website : body.website,
      commercialOwner:
        body.commercialOwner === undefined ? customer.commercialOwner : body.commercialOwner,
      priority: body.priority ?? customer.priority,
      expectedValue:
        body.expectedValue === undefined ? customer.expectedValue : body.expectedValue,
      expectedEnvironment: body.expectedEnvironment ?? customer.expectedEnvironment,
      technicalOwner:
        body.technicalOwner === undefined ? customer.technicalOwner : body.technicalOwner,
      notes: body.notes === undefined ? customer.notes : body.notes,
    });

    await this.customers.save(customer);

    if (body.contacts) {
      await this.contacts.delete({ customerId: id });
      await this.contacts.save(
        body.contacts.map((contact) =>
          this.contacts.create({
            ...this.mapContactBody(contact),
            customerId: id,
          }),
        ),
      );
    }

    return this.getById(id);
  }

  async addContact(customerId: string, body: CreateCustomerContactBody) {
    await this.ensureCustomerExists(customerId);
    const saved = await this.contacts.save(
      this.contacts.create({
        ...this.mapContactBody(body),
        customerId,
      }),
    );

    return this.toContactResponse(saved);
  }

  async addTimelineEntry(customerId: string, body: CreateCustomerTimelineEntryBody) {
    await this.ensureCustomerExists(customerId);
    const saved = await this.timeline.save(
      this.timeline.create({
        customerId,
        type: body.type,
        title: body.title,
        description: body.description ?? null,
        scheduledFor: body.scheduledFor ?? null,
      }),
    );

    return this.toTimelineResponse(saved);
  }

  async addContract(customerId: string, body: CreateCustomerContractBody) {
    await this.ensureCustomerExists(customerId);
    const code = await this.generateContractCode();
    const saved = await this.contracts.save(
      this.contracts.create({
        customerId,
        code,
        plan: body.plan,
        planId: body.planId ?? null,
        status: body.status,
        cycle: body.cycle,
        monthlyValue: body.monthlyValue ?? null,
        setupValue: body.setupValue ?? null,
        startsOn: body.startsOn ?? null,
        endsOn: body.endsOn ?? null,
        dueDay: body.dueDay ?? null,
        paymentMethod: body.paymentMethod ?? null,
        signingContact: body.signingContact ?? null,
        notes: body.notes ?? null,
      }),
    );

    return this.toContractResponse(saved);
  }

  async updateContract(
    customerId: string,
    contractId: string,
    body: UpdateCustomerContractBody,
  ) {
    const contract = await this.contracts.findOne({
      where: { id: contractId, customerId },
    });

    if (!contract) throw new NotFoundException('Contrato não encontrado.');

    this.validateContractUpdate(contract, body);
    const previousStatus = contract.status;

    Object.assign(contract, {
      plan: body.plan ?? contract.plan,
      planId: body.planId === undefined ? contract.planId : body.planId,
      status: body.status ?? contract.status,
      cycle: body.cycle ?? contract.cycle,
      monthlyValue:
        body.monthlyValue === undefined ? contract.monthlyValue : body.monthlyValue,
      setupValue: body.setupValue === undefined ? contract.setupValue : body.setupValue,
      startsOn: body.startsOn === undefined ? contract.startsOn : body.startsOn,
      endsOn: body.endsOn === undefined ? contract.endsOn : body.endsOn,
      dueDay: body.dueDay === undefined ? contract.dueDay : body.dueDay,
      paymentMethod:
        body.paymentMethod === undefined ? contract.paymentMethod : body.paymentMethod,
      signingContact:
        body.signingContact === undefined ? contract.signingContact : body.signingContact,
      notes: body.notes === undefined ? contract.notes : body.notes,
    });

    const saved = await this.contracts.save(contract);
    if (previousStatus !== saved.status && saved.status === 'encerrado') {
      await this.revokeLicensesForContract(saved.id);
    }
    return this.toContractResponse(saved);
  }

  async issueContractLicense(
    customerId: string,
    contractId: string,
  ): Promise<ActivateLicenseResponse> {
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const contract = await this.contracts.findOne({
      where: { id: contractId, customerId },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado.');

    if (contract.status !== 'ativo') {
      throw new BadRequestException(
        'A licença só pode ser emitida para contrato ativo.',
      );
    }

    const activeLicense =
      await this.licensing.request<ActiveContractLicenseResponse>(
        `/admin/licenses/contracts/${encodeURIComponent(contract.id)}/active`,
      );

    if (activeLicense.license) {
      return activeLicense.license;
    }

    return this.licensing.request<ActivateLicenseResponse>(
      '/admin/licenses/activate',
      {
        method: 'POST',
        body: {
          customerId: customer.id,
          contractId: contract.id,
          installationName: `${customer.name} - ${contract.plan}`,
          expiresAt: this.resolveContractLicenseExpiration(contract).toISOString(),
          planId: await this.resolveContractPlanId(contract),
        },
      },
    );
  }

  private validateContractUpdate(
    contract: CustomerContractOrmEntity,
    body: UpdateCustomerContractBody,
  ): void {
    const nextStatus = body.status ?? contract.status;
    const allowedStatuses = this.allowedContractStatuses(contract.status);

    if (!allowedStatuses.includes(nextStatus)) {
      throw new BadRequestException(
        `Fluxo de status inválido: contrato ${contract.status} não pode ir para ${nextStatus}.`,
      );
    }

    if (contract.status === 'encerrado' || contract.status === 'cancelado') {
      throw new BadRequestException('Contrato encerrado ou cancelado não pode ser alterado.');
    }

    if (contract.status === 'ativo' && this.hasActiveContractDataChanges(contract, body)) {
      throw new BadRequestException(
        'Contrato ativo não pode ter dados comerciais alterados. Encerre o contrato e crie um novo para novas condições.',
      );
    }
  }

  private allowedContractStatuses(status: CustomerContractStatus): CustomerContractStatus[] {
    const transitions: Record<CustomerContractStatus, CustomerContractStatus[]> = {
      rascunho: ['rascunho', 'em_assinatura', 'ativo', 'cancelado'],
      em_assinatura: ['em_assinatura', 'ativo', 'cancelado'],
      ativo: ['ativo', 'encerrado'],
      encerrado: ['encerrado'],
      cancelado: ['cancelado'],
    };

    return transitions[status];
  }

  private hasActiveContractDataChanges(
    contract: CustomerContractOrmEntity,
    body: UpdateCustomerContractBody,
  ): boolean {
    const fields: Array<keyof UpdateCustomerContractBody> = [
      'plan',
      'planId',
      'cycle',
      'monthlyValue',
      'setupValue',
      'startsOn',
      'endsOn',
      'dueDay',
      'paymentMethod',
      'signingContact',
      'notes',
    ];

    return fields.some((field) => {
      if (body[field] === undefined) return false;
      return (body[field] ?? null) !== (contract[this.contractFieldToEntityField(field)] ?? null);
    });
  }

  private contractFieldToEntityField(
    field: keyof UpdateCustomerContractBody,
  ): keyof CustomerContractOrmEntity {
    const fields: Partial<
      Record<keyof UpdateCustomerContractBody, keyof CustomerContractOrmEntity>
    > = {
      cycle: 'cycle',
      dueDay: 'dueDay',
      endsOn: 'endsOn',
      monthlyValue: 'monthlyValue',
      notes: 'notes',
      paymentMethod: 'paymentMethod',
      plan: 'plan',
      planId: 'planId',
      setupValue: 'setupValue',
      signingContact: 'signingContact',
      startsOn: 'startsOn',
    };

    return fields[field] ?? 'status';
  }

  private async findById(id: string): Promise<CustomerOrmEntity> {
    const customer = await this.customers.findOne({
      where: { id },
      relations: { contacts: true, timeline: true, contracts: true },
      order: {
        contacts: { createdAt: 'ASC' },
        timeline: { createdAt: 'DESC' },
        contracts: { createdAt: 'DESC' },
      },
    });

    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    return customer;
  }

  private async ensureCustomerExists(id: string): Promise<void> {
    const exists = await this.customers.exists({ where: { id } });
    if (!exists) throw new NotFoundException('Cliente não encontrado.');
  }

  private async generateContractCode(): Promise<string> {
    const year = new Date().getFullYear();
    const rows = await this.dataSource.query(
      `
        INSERT INTO control.contract_code_counters (year, last_value)
        VALUES ($1, 1)
        ON CONFLICT (year)
        DO UPDATE SET last_value = control.contract_code_counters.last_value + 1
        RETURNING last_value
      `,
      [year],
    );
    const sequence = String(Number(rows[0].last_value)).padStart(6, '0');
    return `CT-${year}-${sequence}`;
  }

  private async resolveContractPlanId(
    contract: CustomerContractOrmEntity,
  ): Promise<string> {
    if (contract.planId) return contract.planId;

    const response = await this.licensing.request<LicensePlanListResponse>(
      '/admin/licenses/plans',
    );
    const normalizedPlan = contract.plan.trim().toLowerCase();
    const plan = response.plans.find(
      (item) =>
        item.active &&
        (item.id.trim().toLowerCase() === normalizedPlan ||
          item.name.trim().toLowerCase() === normalizedPlan),
    );

    if (!plan) {
      throw new BadRequestException(
        'Plano do contrato não foi encontrado no catálogo de licenciamento.',
      );
    }

    contract.planId = plan.id;
    await this.contracts.save(contract);

    return plan.id;
  }

  private resolveContractLicenseExpiration(
    contract: CustomerContractOrmEntity,
  ): Date {
    if (contract.endsOn) {
      return new Date(`${contract.endsOn}T23:59:59.000Z`);
    }

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    return expiresAt;
  }

  private async revokeLicensesForContract(contractId: string): Promise<void> {
    await this.licensing.request(`/admin/licenses/contracts/${contractId}/revoke`, {
      method: 'POST',
    });
  }

  private mapContactBody(body: CreateCustomerContactBody) {
    return {
      name: body.name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      role_title: body.roleTitle ?? null,
      role: body.role,
      preference: body.preference,
    };
  }

  private toResponse(customer: CustomerOrmEntity) {
    return {
      id: customer.id,
      name: customer.name,
      type: customer.type,
      stage: customer.stage,
      legalName: customer.legalName,
      document: customer.document,
      segment: customer.segment,
      website: customer.website,
      commercialOwner: customer.commercialOwner,
      priority: customer.priority,
      expectedValue: customer.expectedValue,
      expectedEnvironment: customer.expectedEnvironment,
      technicalOwner: customer.technicalOwner,
      notes: customer.notes,
      contacts: (customer.contacts ?? []).map((contact) => this.toContactResponse(contact)),
      timeline: (customer.timeline ?? []).map((entry) => this.toTimelineResponse(entry)),
      contracts: (customer.contracts ?? []).map((contract) => this.toContractResponse(contract)),
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  private toContactResponse(contact: CustomerContactOrmEntity) {
    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      roleTitle: contact.role_title,
      role: contact.role,
      preference: contact.preference,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
  }

  private toTimelineResponse(entry: CustomerTimelineEntryOrmEntity) {
    return {
      id: entry.id,
      type: entry.type,
      title: entry.title,
      description: entry.description,
      scheduledFor: entry.scheduledFor,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private toContractResponse(contract: CustomerContractOrmEntity) {
    return {
      id: contract.id,
      code: contract.code,
      plan: contract.plan,
      planId: contract.planId,
      status: contract.status,
      cycle: contract.cycle,
      monthlyValue: contract.monthlyValue,
      setupValue: contract.setupValue,
      startsOn: contract.startsOn,
      endsOn: contract.endsOn,
      dueDay: contract.dueDay,
      paymentMethod: contract.paymentMethod,
      signingContact: contract.signingContact,
      notes: contract.notes,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    };
  }
}
