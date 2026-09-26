export interface FileItem {id:string;seriesId:string;catalogId:string;version:number;name:string;mime:string;bytes:number;sha256:string;state:string;uploadUntil:number;createdAt:number}
export interface CatalogItem {id:string;name:string;content:string;bytes:number;sha256:string}
export interface JobItem {id:string;type:string;state:string;generation:number;attempts:number;dispatch_attempts:number;version:number;last_error:string|null;available_at:number;created_at:number}
export interface NotificationItem {id:string;order_id:string;code:string;created_at:number;read_at:number|null}
export interface ActivityItem {id:number;action:string;entity_id:string;code:string|null;created_at:number}
export interface Operations {counts:{state:string;count:number}[];incidents:{id:number;code:string;created_at:number}[];indexers:{deployment_id:string;last_error:string|null;status:string}[];storageConfigured:boolean;queueConfigured:boolean}
export interface Recovery {order:{id:string;paymentState:string;fundsState:string;deliveryState:string;businessState:string;amountU6:string};file:FileItem|null;entitlement:{state:string;retention_until:number}|null;jobs:JobItem[];downloadEligible:boolean;actions:string[];fundsActionsEnabled:false}
export interface DownloadGrant {grantId:string;token:string;expiresAt:number;path:string;file:FileItem}
