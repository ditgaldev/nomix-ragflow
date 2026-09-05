/** Generated from contracts/knowledge-gateway.openapi.json. Do not edit. */
export const knowledgeToolInputSchemas = {
  "knowledge_space_list": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "page": {
        "default": 1,
        "description": "Range: 1 to unbounded.",
        "type": "integer"
      },
      "pageSize": {
        "default": 20,
        "description": "Range: 1 to 100.",
        "type": "integer"
      }
    }
  },
  "knowledge_space_create": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "code": {
        "description": "Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "name": {
        "description": "Length: 1 to 128 Unicode code points.",
        "type": "string",
        "required": true
      },
      "description": {
        "description": "Length: 0 to 1000 Unicode code points.",
        "type": "string"
      },
      "profileCode": {
        "const": "enterprise-long-document",
        "type": "string",
        "required": true
      },
      "defaultSecurityDomainCode": {
        "description": "Length: 1 to 100 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      }
    }
  },
  "knowledge_space_get": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "knowledgeSpaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      }
    }
  },
  "knowledge_space_update": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "knowledgeSpaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "name": {
        "description": "Length: 1 to 128 Unicode code points.",
        "type": "string"
      },
      "description": {
        "description": "Length: 0 to 1000 Unicode code points.",
        "type": "string"
      },
      "expectedVersion": {
        "description": "Range: 1 to unbounded.",
        "type": "integer",
        "required": true
      }
    }
  },
  "knowledge_space_delete": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "knowledgeSpaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "expectedVersion": {
        "description": "Range: 1 to unbounded.",
        "type": "integer",
        "required": true
      },
      "reason": {
        "description": "Length: 1 to 1024 Unicode code points.",
        "type": "string",
        "required": true
      }
    }
  },
  "knowledge_document_list": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "knowledgeSpaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "page": {
        "default": 1,
        "description": "Range: 1 to unbounded.",
        "type": "integer"
      },
      "pageSize": {
        "default": 20,
        "description": "Range: 1 to 100.",
        "type": "integer"
      }
    }
  },
  "knowledge_document_upload": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "knowledgeSpaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "fileResourceId": {
        "description": "Length: 1 to 128 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "documentName": {
        "description": "Length: 1 to 255 Unicode code points.",
        "type": "string",
        "required": true
      },
      "metadata": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "category": {
            "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
            "type": "string"
          },
          "tags": {
            "description": "Items: 0 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            }
          },
          "versionLabel": {
            "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
            "type": "string"
          },
          "productCode": {
            "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
            "type": "string"
          }
        }
      }
    }
  },
  "knowledge_document_get": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      }
    }
  },
  "knowledge_document_update": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "name": {
        "description": "Length: 1 to 255 Unicode code points.",
        "type": "string"
      },
      "metadata": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "category": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "tags": {
            "description": "Items: 0 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            }
          },
          "versionLabel": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "productCode": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "expectedVersion": {
        "description": "Use the document detail lockVersion (or summary version), including zero. Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      }
    }
  },
  "knowledge_document_replace": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "fileResourceId": {
        "description": "Length: 1 to 128 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "expectedVersion": {
        "description": "Use the document detail lockVersion (or summary version), including zero. Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      },
      "reason": {
        "description": "Length: 1 to 1024 Unicode code points.",
        "type": "string"
      }
    }
  },
  "knowledge_document_enable": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "expectedVersion": {
        "description": "Use the document detail lockVersion (or summary version), including zero. Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      },
      "reason": {
        "description": "Length: 1 to 1024 Unicode code points.",
        "type": "string"
      }
    }
  },
  "knowledge_document_disable": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "expectedVersion": {
        "description": "Use the document detail lockVersion (or summary version), including zero. Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      },
      "reason": {
        "description": "Length: 1 to 1024 Unicode code points.",
        "type": "string"
      }
    }
  },
  "knowledge_document_reindex": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "expectedVersion": {
        "description": "Use the document detail lockVersion (or summary version), including zero. Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      },
      "reason": {
        "description": "Length: 1 to 1024 Unicode code points.",
        "type": "string"
      }
    }
  },
  "knowledge_document_delete": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "expectedVersion": {
        "description": "Use the document detail lockVersion (or summary version), including zero. Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      },
      "reason": {
        "description": "Length: 1 to 1024 Unicode code points.",
        "type": "string",
        "required": true
      }
    }
  },
  "knowledge_document_download": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      }
    }
  },
  "knowledge_search": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "query": {
        "description": "Length: 1 to 4096 Unicode code points.",
        "type": "string",
        "required": true
      },
      "knowledgeSpaceIds": {
        "description": "Items: 1 to 20. Items must be unique.",
        "type": "array",
        "items": {
          "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
          "type": "string"
        }
      },
      "documentIds": {
        "description": "Items: 0 to 20. Items must be unique.",
        "type": "array",
        "items": {
          "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
          "type": "string"
        }
      },
      "limit": {
        "default": 8,
        "description": "Range: 1 to 8.",
        "type": "integer"
      },
      "metadataFilter": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "category": {
            "description": "Items: 1 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            }
          },
          "tagsAny": {
            "description": "Items: 1 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            }
          },
          "tagsAll": {
            "description": "Items: 1 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            }
          },
          "versionLabel": {
            "description": "Items: 1 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            }
          },
          "productCode": {
            "description": "Items: 1 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            }
          }
        }
      }
    }
  },
  "knowledge_source_read": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "citationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "contextBefore": {
        "default": 1000,
        "description": "Range: 0 to 5000.",
        "type": "integer"
      },
      "contextAfter": {
        "default": 1000,
        "description": "Range: 0 to 5000.",
        "type": "integer"
      }
    }
  },
  "knowledge_operation_get": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "operationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      }
    }
  },
  "knowledge_operation_cancel": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "operationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "reason": {
        "description": "Length: 1 to 1024 Unicode code points.",
        "type": "string",
        "required": true
      }
    }
  },
  "knowledge_operation_retry": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "operationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "reason": {
        "description": "Length: 1 to 1024 Unicode code points.",
        "type": "string",
        "required": true
      }
    }
  }
} as const
export const knowledgeToolDataSchemas = {
  "KnowledgeSpaceList": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "items": {
        "description": "Items: 0 to 20.",
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "spaceId": {
              "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string",
              "required": true
            },
            "code": {
              "description": "Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string",
              "required": true
            },
            "name": {
              "description": "Length: 0 to 128 Unicode code points.",
              "type": "string",
              "required": true
            },
            "description": {
              "description": "Length: 0 to 1000 Unicode code points.",
              "type": "string"
            },
            "profileCode": {
              "const": "enterprise-long-document",
              "type": "string"
            },
            "defaultSecurityDomainCode": {
              "description": "Length: 1 to 100 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            },
            "status": {
              "enum": [
                "CREATING",
                "ACTIVE",
                "CREATE_FAILED",
                "DISABLED",
                "DELETING",
                "DELETED",
                "DELETE_FAILED"
              ],
              "type": "string",
              "required": true
            },
            "version": {
              "description": "Range: 1 to unbounded.",
              "type": "integer",
              "required": true
            }
          }
        },
        "required": true
      }
    }
  },
  "KnowledgeSpaceCreated": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "spaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "code": {
        "description": "Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "name": {
        "description": "Length: 0 to 128 Unicode code points.",
        "type": "string",
        "required": true
      },
      "status": {
        "enum": [
          "CREATING",
          "ACTIVE",
          "CREATE_FAILED",
          "DISABLED",
          "DELETING",
          "DELETED",
          "DELETE_FAILED"
        ],
        "type": "string",
        "required": true
      },
      "version": {
        "description": "Range: 1 to unbounded.",
        "type": "integer",
        "required": true
      }
    }
  },
  "KnowledgeSpace": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "spaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "code": {
        "description": "Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "name": {
        "description": "Length: 0 to 128 Unicode code points.",
        "type": "string",
        "required": true
      },
      "description": {
        "description": "Length: 0 to 1000 Unicode code points.",
        "type": "string"
      },
      "profileCode": {
        "const": "enterprise-long-document",
        "type": "string"
      },
      "defaultSecurityDomainCode": {
        "description": "Length: 1 to 100 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string"
      },
      "status": {
        "enum": [
          "CREATING",
          "ACTIVE",
          "CREATE_FAILED",
          "DISABLED",
          "DELETING",
          "DELETED",
          "DELETE_FAILED"
        ],
        "type": "string",
        "required": true
      },
      "version": {
        "description": "Range: 1 to unbounded.",
        "type": "integer",
        "required": true
      }
    }
  },
  "KnowledgeSpaceUpdated": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "spaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "name": {
        "description": "Length: 0 to 128 Unicode code points.",
        "type": "string",
        "required": true
      },
      "description": {
        "description": "Length: 0 to 1000 Unicode code points.",
        "type": "string"
      },
      "status": {
        "enum": [
          "CREATING",
          "ACTIVE",
          "CREATE_FAILED",
          "DISABLED",
          "DELETING",
          "DELETED",
          "DELETE_FAILED"
        ],
        "type": "string",
        "required": true
      },
      "version": {
        "description": "Range: 1 to unbounded.",
        "type": "integer",
        "required": true
      }
    }
  },
  "SpaceOperationAccepted": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "spaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "operationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "status": {
        "enum": [
          "PENDING",
          "RUNNING",
          "SUCCEEDED",
          "FAILED",
          "CANCELLED"
        ],
        "type": "string",
        "required": true
      }
    }
  },
  "KnowledgeDocumentList": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "items": {
        "description": "Items: 0 to 20.",
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "documentId": {
              "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string",
              "required": true
            },
            "knowledgeSpaceId": {
              "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string",
              "required": true
            },
            "name": {
              "description": "Length: 0 to 255 Unicode code points.",
              "type": "string",
              "required": true
            },
            "status": {
              "enum": [
                "CREATING",
                "ACTIVE",
                "CREATE_FAILED",
                "DISABLED",
                "DELETING",
                "DELETED"
              ],
              "type": "string",
              "required": true
            },
            "version": {
              "description": "Range: 0 to unbounded.",
              "type": "integer",
              "required": true
            },
            "metadata": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "category": {
                  "oneOf": [
                    {
                      "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ],
                  "required": true
                },
                "tags": {
                  "description": "Items: 0 to 20. Items must be unique.",
                  "type": "array",
                  "items": {
                    "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  "required": true
                },
                "versionLabel": {
                  "oneOf": [
                    {
                      "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ],
                  "required": true
                },
                "productCode": {
                  "oneOf": [
                    {
                      "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ],
                  "required": true
                }
              },
              "required": true
            },
            "activeVersion": {
              "oneOf": [
                {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "versionId": {
                      "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                      "type": "string",
                      "required": true
                    },
                    "versionNumber": {
                      "description": "Range: 1 to unbounded.",
                      "type": "integer",
                      "required": true
                    },
                    "status": {
                      "enum": [
                        "CREATED",
                        "UPLOADING",
                        "UPLOADED",
                        "INGESTING",
                        "READY",
                        "FAILED",
                        "CANCELLED",
                        "RETIRED",
                        "DELETED"
                      ],
                      "type": "string",
                      "required": true
                    },
                    "fileName": {
                      "description": "Length: 0 to 1024 Unicode code points.",
                      "type": "string",
                      "required": true
                    },
                    "mimeType": {
                      "description": "Length: 0 to 256 Unicode code points.",
                      "type": "string",
                      "required": true
                    },
                    "fileSize": {
                      "description": "Range: 0 to unbounded.",
                      "type": "integer",
                      "required": true
                    },
                    "failureCode": {
                      "enum": [
                        "KNOWLEDGE_UNAUTHENTICATED",
                        "KNOWLEDGE_FORBIDDEN",
                        "KNOWLEDGE_NOT_FOUND",
                        "KNOWLEDGE_CONFLICT",
                        "KNOWLEDGE_OPERATION_PENDING",
                        "KNOWLEDGE_PROVIDER_UNAVAILABLE",
                        "KNOWLEDGE_INVALID_INPUT"
                      ],
                      "type": "string"
                    }
                  }
                },
                {
                  "type": "null"
                }
              ],
              "required": true
            }
          }
        },
        "required": true
      }
    }
  },
  "DocumentOperationAccepted": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "operationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "status": {
        "enum": [
          "PENDING",
          "RUNNING",
          "SUCCEEDED",
          "FAILED",
          "CANCELLED"
        ],
        "type": "string",
        "required": true
      }
    }
  },
  "KnowledgeDocumentDetail": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "spaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "name": {
        "description": "Length: 1 to 255 Unicode code points.",
        "type": "string",
        "required": true
      },
      "status": {
        "enum": [
          "CREATING",
          "ACTIVE",
          "CREATE_FAILED",
          "DISABLED",
          "DELETING",
          "DELETED"
        ],
        "type": "string",
        "required": true
      },
      "searchable": {
        "type": "boolean",
        "required": true
      },
      "metadata": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "category": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "required": true
          },
          "tags": {
            "description": "Items: 0 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            },
            "required": true
          },
          "versionLabel": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "required": true
          },
          "productCode": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "required": true
          }
        },
        "required": true
      },
      "lockVersion": {
        "description": "Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      },
      "activeVersion": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "versionId": {
                "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string",
                "required": true
              },
              "versionNo": {
                "description": "Range: 1 to unbounded.",
                "type": "integer",
                "required": true
              },
              "changeType": {
                "enum": [
                  "INITIAL_UPLOAD",
                  "REPLACE",
                  "REINDEX"
                ],
                "type": "string",
                "required": true
              },
              "status": {
                "enum": [
                  "CREATED",
                  "UPLOADING",
                  "UPLOADED",
                  "INGESTING",
                  "READY",
                  "FAILED",
                  "CANCELLED",
                  "RETIRED",
                  "DELETED"
                ],
                "type": "string",
                "required": true
              },
              "fileName": {
                "description": "Length: 1 to 255 Unicode code points.",
                "type": "string",
                "required": true
              },
              "mimeType": {
                "description": "Length: 1 to 128 Unicode code points.",
                "type": "string",
                "required": true
              },
              "fileSize": {
                "description": "Range: 0 to unbounded.",
                "type": "integer",
                "required": true
              },
              "operationId": {
                "oneOf": [
                  {
                    "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "operationStatus": {
                "oneOf": [
                  {
                    "enum": [
                      "PENDING",
                      "RUNNING",
                      "SUCCEEDED",
                      "FAILED",
                      "CANCELLED"
                    ],
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "progressPercent": {
                "oneOf": [
                  {
                    "description": "Range: 0 to 100.",
                    "type": "integer"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "progressSource": {
                "enum": [
                  "PROVIDER",
                  "TERMINAL_STATE",
                  "UNAVAILABLE"
                ],
                "type": "string",
                "required": true
              },
              "progressUpdatedAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "retryable": {
                "type": "boolean",
                "required": true
              },
              "error": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                      "code": {
                        "description": "Length: 1 to 64 Unicode code points.",
                        "type": "string",
                        "required": true
                      },
                      "message": {
                        "description": "Length: 1 to 2000 Unicode code points.",
                        "type": "string",
                        "required": true
                      },
                      "retryable": {
                        "type": "boolean",
                        "required": true
                      }
                    }
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "createdAt": {
                "description": "Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string",
                "required": true
              },
              "processingStartedAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "readyAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "activatedAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "failedAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "cancelledAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              }
            }
          },
          {
            "type": "null"
          }
        ],
        "required": true
      },
      "candidateVersion": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "versionId": {
                "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string",
                "required": true
              },
              "versionNo": {
                "description": "Range: 1 to unbounded.",
                "type": "integer",
                "required": true
              },
              "changeType": {
                "enum": [
                  "INITIAL_UPLOAD",
                  "REPLACE",
                  "REINDEX"
                ],
                "type": "string",
                "required": true
              },
              "status": {
                "enum": [
                  "CREATED",
                  "UPLOADING",
                  "UPLOADED",
                  "INGESTING",
                  "READY",
                  "FAILED",
                  "CANCELLED",
                  "RETIRED",
                  "DELETED"
                ],
                "type": "string",
                "required": true
              },
              "fileName": {
                "description": "Length: 1 to 255 Unicode code points.",
                "type": "string",
                "required": true
              },
              "mimeType": {
                "description": "Length: 1 to 128 Unicode code points.",
                "type": "string",
                "required": true
              },
              "fileSize": {
                "description": "Range: 0 to unbounded.",
                "type": "integer",
                "required": true
              },
              "operationId": {
                "oneOf": [
                  {
                    "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "operationStatus": {
                "oneOf": [
                  {
                    "enum": [
                      "PENDING",
                      "RUNNING",
                      "SUCCEEDED",
                      "FAILED",
                      "CANCELLED"
                    ],
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "progressPercent": {
                "oneOf": [
                  {
                    "description": "Range: 0 to 100.",
                    "type": "integer"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "progressSource": {
                "enum": [
                  "PROVIDER",
                  "TERMINAL_STATE",
                  "UNAVAILABLE"
                ],
                "type": "string",
                "required": true
              },
              "progressUpdatedAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "retryable": {
                "type": "boolean",
                "required": true
              },
              "error": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                      "code": {
                        "description": "Length: 1 to 64 Unicode code points.",
                        "type": "string",
                        "required": true
                      },
                      "message": {
                        "description": "Length: 1 to 2000 Unicode code points.",
                        "type": "string",
                        "required": true
                      },
                      "retryable": {
                        "type": "boolean",
                        "required": true
                      }
                    }
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "createdAt": {
                "description": "Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string",
                "required": true
              },
              "processingStartedAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "readyAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "activatedAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "failedAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              },
              "cancelledAt": {
                "oneOf": [
                  {
                    "description": "Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "required": true
              }
            }
          },
          {
            "type": "null"
          }
        ],
        "required": true
      },
      "createdAt": {
        "description": "Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "updatedAt": {
        "description": "Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      }
    }
  },
  "KnowledgeDocument": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "knowledgeSpaceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "name": {
        "description": "Length: 0 to 255 Unicode code points.",
        "type": "string",
        "required": true
      },
      "status": {
        "enum": [
          "CREATING",
          "ACTIVE",
          "CREATE_FAILED",
          "DISABLED",
          "DELETING",
          "DELETED"
        ],
        "type": "string",
        "required": true
      },
      "version": {
        "description": "Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      },
      "metadata": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "category": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "required": true
          },
          "tags": {
            "description": "Items: 0 to 20. Items must be unique.",
            "type": "array",
            "items": {
              "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            },
            "required": true
          },
          "versionLabel": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "required": true
          },
          "productCode": {
            "oneOf": [
              {
                "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "required": true
          }
        },
        "required": true
      },
      "activeVersion": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "versionId": {
                "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                "type": "string",
                "required": true
              },
              "versionNumber": {
                "description": "Range: 1 to unbounded.",
                "type": "integer",
                "required": true
              },
              "status": {
                "enum": [
                  "CREATED",
                  "UPLOADING",
                  "UPLOADED",
                  "INGESTING",
                  "READY",
                  "FAILED",
                  "CANCELLED",
                  "RETIRED",
                  "DELETED"
                ],
                "type": "string",
                "required": true
              },
              "fileName": {
                "description": "Length: 0 to 1024 Unicode code points.",
                "type": "string",
                "required": true
              },
              "mimeType": {
                "description": "Length: 0 to 256 Unicode code points.",
                "type": "string",
                "required": true
              },
              "fileSize": {
                "description": "Range: 0 to unbounded.",
                "type": "integer",
                "required": true
              },
              "failureCode": {
                "enum": [
                  "KNOWLEDGE_UNAUTHENTICATED",
                  "KNOWLEDGE_FORBIDDEN",
                  "KNOWLEDGE_NOT_FOUND",
                  "KNOWLEDGE_CONFLICT",
                  "KNOWLEDGE_OPERATION_PENDING",
                  "KNOWLEDGE_PROVIDER_UNAVAILABLE",
                  "KNOWLEDGE_INVALID_INPUT"
                ],
                "type": "string"
              }
            }
          },
          {
            "type": "null"
          }
        ],
        "required": true
      }
    }
  },
  "DownloadLink": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "versionId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "fileName": {
        "description": "Length: 0 to 1024 Unicode code points.",
        "type": "string",
        "required": true
      },
      "mimeType": {
        "description": "Length: 0 to 256 Unicode code points.",
        "type": "string",
        "required": true
      },
      "fileSize": {
        "description": "Range: 0 to unbounded.",
        "type": "integer",
        "required": true
      },
      "downloadUrl": {
        "description": "Length: 0 to 4096 Unicode code points.",
        "type": "string",
        "required": true
      },
      "expiresAt": {
        "type": "string",
        "required": true
      },
      "expiresInSeconds": {
        "const": 60,
        "type": "integer",
        "required": true
      }
    }
  },
  "RetrievalResult": {
    "oneOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "query": {
            "description": "Length: 0 to 4096 Unicode code points.",
            "type": "string",
            "required": true
          },
          "hits": {
            "description": "Items: 1 to 8.",
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "citationId": {
                  "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                  "type": "string",
                  "required": true
                },
                "documentId": {
                  "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                  "type": "string",
                  "required": true
                },
                "documentName": {
                  "description": "Length: 0 to 255 Unicode code points.",
                  "type": "string",
                  "required": true
                },
                "chapterPath": {
                  "description": "Items: 0 to 20.",
                  "type": "array",
                  "items": {
                    "description": "Length: 0 to 512 Unicode code points.",
                    "type": "string"
                  },
                  "required": true
                },
                "content": {
                  "description": "Length: 0 to 2500 Unicode code points.",
                  "type": "string",
                  "required": true
                },
                "score": {
                  "description": "Range: 0 to 1.",
                  "type": "number",
                  "required": true
                },
                "locationPrecision": {
                  "enum": [
                    "EXACT_OFFSET",
                    "CHUNK_APPROXIMATE"
                  ],
                  "type": "string"
                },
                "page": {
                  "description": "Range: 1 to unbounded.",
                  "type": "integer"
                },
                "metadata": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "category": {
                      "oneOf": [
                        {
                          "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ],
                      "required": true
                    },
                    "tags": {
                      "description": "Items: 0 to 20. Items must be unique.",
                      "type": "array",
                      "items": {
                        "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                        "type": "string"
                      },
                      "required": true
                    },
                    "versionLabel": {
                      "oneOf": [
                        {
                          "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ],
                      "required": true
                    },
                    "productCode": {
                      "oneOf": [
                        {
                          "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ],
                      "required": true
                    }
                  },
                  "required": true
                }
              }
            },
            "required": true
          },
          "traceId": {
            "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
            "type": "string",
            "required": true
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "query": {
            "description": "Length: 0 to 4096 Unicode code points.",
            "type": "string"
          },
          "hits": {
            "description": "Items: 0 to 0.",
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "citationId": {
                  "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                  "type": "string",
                  "required": true
                },
                "documentId": {
                  "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                  "type": "string",
                  "required": true
                },
                "documentName": {
                  "description": "Length: 0 to 255 Unicode code points.",
                  "type": "string",
                  "required": true
                },
                "chapterPath": {
                  "description": "Items: 0 to 20.",
                  "type": "array",
                  "items": {
                    "description": "Length: 0 to 512 Unicode code points.",
                    "type": "string"
                  },
                  "required": true
                },
                "content": {
                  "description": "Length: 0 to 2500 Unicode code points.",
                  "type": "string",
                  "required": true
                },
                "score": {
                  "description": "Range: 0 to 1.",
                  "type": "number",
                  "required": true
                },
                "locationPrecision": {
                  "enum": [
                    "EXACT_OFFSET",
                    "CHUNK_APPROXIMATE"
                  ],
                  "type": "string"
                },
                "page": {
                  "description": "Range: 1 to unbounded.",
                  "type": "integer"
                },
                "metadata": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "category": {
                      "oneOf": [
                        {
                          "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ],
                      "required": true
                    },
                    "tags": {
                      "description": "Items: 0 to 20. Items must be unique.",
                      "type": "array",
                      "items": {
                        "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                        "type": "string"
                      },
                      "required": true
                    },
                    "versionLabel": {
                      "oneOf": [
                        {
                          "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ],
                      "required": true
                    },
                    "productCode": {
                      "oneOf": [
                        {
                          "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ],
                      "required": true
                    }
                  },
                  "required": true
                }
              }
            },
            "required": true
          },
          "traceId": {
            "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
            "type": "string"
          },
          "reason": {
            "const": "NO_AUTHORIZED_RELEVANT_EVIDENCE",
            "type": "string",
            "required": true
          }
        }
      }
    ]
  },
  "CitationSource": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "citationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "documentId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "versionId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "documentName": {
        "description": "Length: 0 to 255 Unicode code points.",
        "type": "string",
        "required": true
      },
      "chapterPath": {
        "description": "Items: 0 to 20.",
        "type": "array",
        "items": {
          "description": "Length: 0 to 512 Unicode code points.",
          "type": "string"
        }
      },
      "pageStart": {
        "description": "Range: 1 to unbounded.",
        "type": "integer"
      },
      "pageEnd": {
        "description": "Range: 1 to unbounded.",
        "type": "integer"
      },
      "beforeContent": {
        "description": "Length: 0 to 5000 Unicode code points.",
        "type": "string",
        "required": true
      },
      "matchedContent": {
        "description": "Length: 0 to 2500 Unicode code points.",
        "type": "string",
        "required": true
      },
      "afterContent": {
        "description": "Length: 0 to 5000 Unicode code points.",
        "type": "string",
        "required": true
      },
      "requestedContextBefore": {
        "description": "Range: 0 to 5000.",
        "type": "integer",
        "required": true
      },
      "requestedContextAfter": {
        "description": "Range: 0 to 5000.",
        "type": "integer",
        "required": true
      },
      "actualContextBefore": {
        "description": "Range: 0 to 5000.",
        "type": "integer",
        "required": true
      },
      "actualContextAfter": {
        "description": "Range: 0 to 5000.",
        "type": "integer",
        "required": true
      },
      "matchedContentTruncated": {
        "type": "boolean",
        "required": true
      },
      "locationPrecision": {
        "enum": [
          "EXACT_OFFSET",
          "CHUNK_APPROXIMATE"
        ],
        "type": "string",
        "required": true
      }
    }
  },
  "KnowledgeOperation": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "operationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "parentOperationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string"
      },
      "status": {
        "enum": [
          "PENDING",
          "RUNNING",
          "SUCCEEDED",
          "FAILED",
          "CANCELLED"
        ],
        "type": "string",
        "required": true
      },
      "operationType": {
        "enum": [
          "SPACE_CREATE",
          "SPACE_UPDATE",
          "SPACE_DELETE",
          "DOCUMENT_UPLOAD",
          "DOCUMENT_UPDATE",
          "DOCUMENT_REPLACE",
          "DOCUMENT_ENABLE",
          "DOCUMENT_DISABLE",
          "DOCUMENT_REINDEX",
          "DOCUMENT_DELETE",
          "OPERATION_CANCEL",
          "OPERATION_RETRY"
        ],
        "type": "string",
        "required": true
      },
      "resourceType": {
        "enum": [
          "SPACE",
          "DOCUMENT",
          "VERSION",
          "OPERATION"
        ],
        "type": "string"
      },
      "resourceId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string"
      },
      "manualRetryAttempt": {
        "description": "Range: 0 to 3.",
        "type": "integer"
      },
      "createdAt": {
        "type": "string",
        "required": true
      },
      "updatedAt": {
        "type": "string"
      },
      "failureCode": {
        "enum": [
          "KNOWLEDGE_UNAUTHENTICATED",
          "KNOWLEDGE_FORBIDDEN",
          "KNOWLEDGE_NOT_FOUND",
          "KNOWLEDGE_CONFLICT",
          "KNOWLEDGE_OPERATION_PENDING",
          "KNOWLEDGE_PROVIDER_UNAVAILABLE",
          "KNOWLEDGE_INVALID_INPUT"
        ],
        "type": "string"
      },
      "nextPollAfterMs": {
        "description": "Range: 0 to 60000.",
        "type": "integer"
      },
      "retryable": {
        "type": "boolean"
      },
      "retryCount": {
        "description": "Range: 0 to 5.",
        "type": "integer"
      },
      "lastRetryAt": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "nextRetryAt": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    }
  },
  "ManualRetryOperation": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "operationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "parentOperationId": {
        "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
        "type": "string",
        "required": true
      },
      "status": {
        "enum": [
          "PENDING",
          "RUNNING",
          "SUCCEEDED",
          "FAILED",
          "CANCELLED"
        ],
        "type": "string",
        "required": true
      }
    }
  },
  "KnowledgeSpacePage": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "items": {
        "description": "Items: 0 to 20.",
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "spaceId": {
              "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string",
              "required": true
            },
            "code": {
              "description": "Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string",
              "required": true
            },
            "name": {
              "description": "Length: 0 to 128 Unicode code points.",
              "type": "string",
              "required": true
            },
            "description": {
              "description": "Length: 0 to 1000 Unicode code points.",
              "type": "string"
            },
            "profileCode": {
              "const": "enterprise-long-document",
              "type": "string"
            },
            "defaultSecurityDomainCode": {
              "description": "Length: 1 to 100 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string"
            },
            "status": {
              "enum": [
                "CREATING",
                "ACTIVE",
                "CREATE_FAILED",
                "DISABLED",
                "DELETING",
                "DELETED",
                "DELETE_FAILED"
              ],
              "type": "string",
              "required": true
            },
            "version": {
              "description": "Range: 1 to unbounded.",
              "type": "integer",
              "required": true
            }
          }
        },
        "required": true
      },
      "pagination": {
        "description": "page/pageSize echo the request. totalItems counts visible matching resources; totalPages=ceil(totalItems/pageSize); hasNext=page<totalPages. Empty results use totalPages=0; pages beyond totalPages return empty items. Items cannot exceed pageSize or the remaining total.",
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "page": {
            "description": "Range: 1 to unbounded.",
            "type": "integer",
            "required": true
          },
          "pageSize": {
            "description": "Range: 1 to 100.",
            "type": "integer",
            "required": true
          },
          "totalItems": {
            "description": "Range: 0 to unbounded.",
            "type": "integer",
            "required": true
          },
          "totalPages": {
            "description": "Range: 0 to unbounded.",
            "type": "integer",
            "required": true
          },
          "hasNext": {
            "type": "boolean",
            "required": true
          }
        },
        "required": true
      }
    }
  },
  "KnowledgeDocumentPage": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "items": {
        "description": "Items: 0 to 20.",
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "documentId": {
              "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string",
              "required": true
            },
            "knowledgeSpaceId": {
              "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
              "type": "string",
              "required": true
            },
            "name": {
              "description": "Length: 0 to 255 Unicode code points.",
              "type": "string",
              "required": true
            },
            "status": {
              "enum": [
                "CREATING",
                "ACTIVE",
                "CREATE_FAILED",
                "DISABLED",
                "DELETING",
                "DELETED"
              ],
              "type": "string",
              "required": true
            },
            "version": {
              "description": "Range: 0 to unbounded.",
              "type": "integer",
              "required": true
            },
            "metadata": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "category": {
                  "oneOf": [
                    {
                      "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ],
                  "required": true
                },
                "tags": {
                  "description": "Items: 0 to 20. Items must be unique.",
                  "type": "array",
                  "items": {
                    "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 32 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                    "type": "string"
                  },
                  "required": true
                },
                "versionLabel": {
                  "oneOf": [
                    {
                      "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ],
                  "required": true
                },
                "productCode": {
                  "oneOf": [
                    {
                      "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive. Length: 1 to 64 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ],
                  "required": true
                }
              },
              "required": true
            },
            "activeVersion": {
              "oneOf": [
                {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "versionId": {
                      "description": "Length: 1 to 256 Unicode code points. Must be a non-whitespace opaque business identifier when applicable.",
                      "type": "string",
                      "required": true
                    },
                    "versionNumber": {
                      "description": "Range: 1 to unbounded.",
                      "type": "integer",
                      "required": true
                    },
                    "status": {
                      "enum": [
                        "CREATED",
                        "UPLOADING",
                        "UPLOADED",
                        "INGESTING",
                        "READY",
                        "FAILED",
                        "CANCELLED",
                        "RETIRED",
                        "DELETED"
                      ],
                      "type": "string",
                      "required": true
                    },
                    "fileName": {
                      "description": "Length: 0 to 1024 Unicode code points.",
                      "type": "string",
                      "required": true
                    },
                    "mimeType": {
                      "description": "Length: 0 to 256 Unicode code points.",
                      "type": "string",
                      "required": true
                    },
                    "fileSize": {
                      "description": "Range: 0 to unbounded.",
                      "type": "integer",
                      "required": true
                    },
                    "failureCode": {
                      "enum": [
                        "KNOWLEDGE_UNAUTHENTICATED",
                        "KNOWLEDGE_FORBIDDEN",
                        "KNOWLEDGE_NOT_FOUND",
                        "KNOWLEDGE_CONFLICT",
                        "KNOWLEDGE_OPERATION_PENDING",
                        "KNOWLEDGE_PROVIDER_UNAVAILABLE",
                        "KNOWLEDGE_INVALID_INPUT"
                      ],
                      "type": "string"
                    }
                  }
                },
                {
                  "type": "null"
                }
              ],
              "required": true
            }
          }
        },
        "required": true
      },
      "pagination": {
        "description": "page/pageSize echo the request. totalItems counts visible matching resources; totalPages=ceil(totalItems/pageSize); hasNext=page<totalPages. Empty results use totalPages=0; pages beyond totalPages return empty items. Items cannot exceed pageSize or the remaining total.",
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "page": {
            "description": "Range: 1 to unbounded.",
            "type": "integer",
            "required": true
          },
          "pageSize": {
            "description": "Range: 1 to 100.",
            "type": "integer",
            "required": true
          },
          "totalItems": {
            "description": "Range: 0 to unbounded.",
            "type": "integer",
            "required": true
          },
          "totalPages": {
            "description": "Range: 0 to unbounded.",
            "type": "integer",
            "required": true
          },
          "hasNext": {
            "type": "boolean",
            "required": true
          }
        },
        "required": true
      }
    }
  }
} as const
