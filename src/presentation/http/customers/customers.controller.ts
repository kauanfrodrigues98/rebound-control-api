import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CustomersService } from '../../../customers/customers.service';
import {
  createCustomerContractSchema,
  createCustomerSchema,
  createCustomerTimelineEntrySchema,
  customerContactSchema,
  updateCustomerContractSchema,
  updateCustomerSchema,
} from '../../../customers/customer.contracts';
import type {
  CreateCustomerBody,
  CreateCustomerContactBody,
  CreateCustomerContractBody,
  CreateCustomerTimelineEntryBody,
  UpdateCustomerBody,
  UpdateCustomerContractBody,
} from '../../../customers/customer.contracts';
import { AuthGuard } from '../../../infra/security/auth.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';

@UseGuards(AuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('stage') stage?: string,
    @Query('environment') environment?: string,
  ) {
    return this.customers.list({ search, stage, environment });
  }

  @Get(':customerId')
  getById(@Param('customerId') customerId: string) {
    return this.customers.getById(customerId);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createCustomerSchema)) body: CreateCustomerBody) {
    return this.customers.create(body);
  }

  @Put(':customerId')
  update(
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomerBody,
  ) {
    return this.customers.update(customerId, body);
  }

  @Post(':customerId/contacts')
  addContact(
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(customerContactSchema)) body: CreateCustomerContactBody,
  ) {
    return this.customers.addContact(customerId, body);
  }

  @Post(':customerId/timeline')
  addTimelineEntry(
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(createCustomerTimelineEntrySchema))
    body: CreateCustomerTimelineEntryBody,
  ) {
    return this.customers.addTimelineEntry(customerId, body);
  }

  @Post(':customerId/contracts')
  addContract(
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(createCustomerContractSchema))
    body: CreateCustomerContractBody,
  ) {
    return this.customers.addContract(customerId, body);
  }

  @Put(':customerId/contracts/:contractId')
  updateContract(
    @Param('customerId') customerId: string,
    @Param('contractId') contractId: string,
    @Body(new ZodValidationPipe(updateCustomerContractSchema))
    body: UpdateCustomerContractBody,
  ) {
    return this.customers.updateContract(customerId, contractId, body);
  }

  @Post(':customerId/contracts/:contractId/license')
  issueContractLicense(
    @Param('customerId') customerId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.customers.issueContractLicense(customerId, contractId);
  }
}
