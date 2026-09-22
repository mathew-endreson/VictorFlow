import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  createContactSchema,
  createCustomerSchema,
  customerListQuerySchema,
  PERMISSIONS,
  updateContactSchema,
  updateCustomerSchema,
  type ContactDto,
  type CreateContactDto,
  type CreateCustomerDto,
  type CustomerDetailDto,
  type CustomerDto,
  type CustomerListQuery,
  type Page,
  type UpdateContactDto,
  type UpdateCustomerDto,
} from '@victorflow/types';
import { CurrentUser, RequirePermissions, type Principal, RequiresFeature } from '../../common/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/zod.pipe';
import { CustomersService } from './customers.service';

@RequiresFeature('crm')
@Controller()
export class CrmController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermissions(PERMISSIONS.CRM_CUSTOMER_READ)
  @Get('customers')
  list(@ZQuery(customerListQuerySchema) query: CustomerListQuery): Promise<Page<CustomerDto>> {
    return this.customers.list(query);
  }

  @RequirePermissions(PERMISSIONS.CRM_CUSTOMER_READ)
  @Get('customers/:id')
  get(@IdParam() id: string): Promise<CustomerDetailDto> {
    return this.customers.get(id);
  }

  @RequirePermissions(PERMISSIONS.CRM_CUSTOMER_WRITE)
  @Post('customers')
  create(@ZBody(createCustomerSchema) dto: CreateCustomerDto, @CurrentUser() user: Principal): Promise<CustomerDto> {
    return this.customers.create(dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.CRM_CUSTOMER_WRITE)
  @Patch('customers/:id')
  update(@IdParam() id: string, @ZBody(updateCustomerSchema) dto: UpdateCustomerDto): Promise<CustomerDto> {
    return this.customers.update(id, dto);
  }

  @RequirePermissions(PERMISSIONS.CRM_CUSTOMER_DELETE)
  @Delete('customers/:id')
  @HttpCode(204)
  async remove(@IdParam() id: string): Promise<void> {
    await this.customers.remove(id);
  }

  @RequirePermissions(PERMISSIONS.CRM_CUSTOMER_WRITE)
  @Post('customers/:id/contacts')
  addContact(@IdParam() id: string, @ZBody(createContactSchema) dto: CreateContactDto): Promise<ContactDto> {
    return this.customers.addContact(id, dto);
  }

  @RequirePermissions(PERMISSIONS.CRM_CUSTOMER_WRITE)
  @Patch('contacts/:id')
  updateContact(@IdParam() id: string, @ZBody(updateContactSchema) dto: UpdateContactDto): Promise<ContactDto> {
    return this.customers.updateContact(id, dto);
  }

  @RequirePermissions(PERMISSIONS.CRM_CUSTOMER_WRITE)
  @Delete('contacts/:id')
  @HttpCode(204)
  async removeContact(@IdParam() id: string): Promise<void> {
    await this.customers.removeContact(id);
  }
}
